import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  CoderOutput,
  CommandSpec,
  MicroUsd,
  OrchAttempt,
  OrchRun,
  OrchTask,
  OrchTaskSpec,
  Project,
  ProjectId,
  Result,
} from '@itstudio/schemas';
import type { AgentEnvelope, IAgentExecutionAdapter } from '../../src/kernel/ports/agent-execution.js';
import { systemClock } from '../../src/kernel/infra/clock.js';
import { systemIdGenerator } from '../../src/kernel/infra/id.js';
import { NodeFileSystem } from '../../src/kernel/infra/node-file-system.js';
import { NodeProcessRunner } from '../../src/kernel/infra/node-process-runner.js';
import { openDatabase } from '../../src/kernel/infra/sqlite/database.js';
import { projects } from '../../src/kernel/infra/sqlite/schema.js';
import { CommandRunner } from '../../src/modules/pipeline/services/command-runner.js';
import { WriteTransactionService } from '../../src/modules/pipeline/services/write-transaction.js';
import { createOrchestrationModule } from '../../src/modules/orchestration/index.js';
import { OrchRepository } from '../../src/modules/orchestration/storage/orch-repository.js';
import { OrchWorkspace, type OrchWorkspaceDependencies } from '../../src/modules/orchestration/workspace.js';
import { WorktreeManager } from '../../src/modules/orchestration/worktrees.js';

// Reliability regressions for the stabilization pass (docs/qa/stabilization/02-DEFECTS.md): real Git
// repositories, real worktrees, real write transactions and a real SQLite file; agents are scripted fakes.

const LONG = 180_000;
const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as ProjectId;
const created: string[] = [];
const connections: { close(): unknown }[] = [];
afterEach(() => {
  // SQLite files stay locked on Windows while a connection is open.
  for (const connection of connections.splice(0)) connection.close();
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

function folder(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitStatus(cwd: string, ...args: string[]): number {
  try {
    execFileSync('git', args, { cwd, stdio: 'ignore' });
    return 0;
  } catch {
    return 1;
  }
}

function repository(files: Readonly<Record<string, string>>): string {
  const dir = folder('itstudio-orch-rel-');
  git(dir, 'init', '-q', '-b', 'main');
  for (const [key, value] of [
    ['user.name', 'IT Studio Test'],
    ['user.email', 'test@example.invalid'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
  ] as const)
    git(dir, 'config', key, value);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  return dir;
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8').replace(/\r\n/gu, '\n');
}

const project = (root: string): Project =>
  ({
    id: PROJECT_ID,
    name: 'Repo',
    workspaceRoot: root,
    createdAt: '2026-10-20T00:00:00.000Z',
    archived: false,
  }) as Project;

interface WorkspaceOverrides {
  readonly writer?: OrchWorkspaceDependencies['apply']['writer'];
  readonly commands?: OrchWorkspaceDependencies['apply']['commands'];
  readonly prepareAttempt?: () => Promise<never>;
}

function workspaceFor(root: string, overrides: WorkspaceOverrides = {}): OrchWorkspace {
  const runner = new NodeProcessRunner();
  const fileSystem = new NodeFileSystem();
  const workspace = new OrchWorkspace({
    projects: { get: () => Promise.resolve(project(root)) },
    worktrees: new WorktreeManager(runner),
    apply: {
      runner,
      fileSystem,
      commands: overrides.commands ?? new CommandRunner({ processRunner: runner, fileSystem, ids: systemIdGenerator }),
      writer:
        overrides.writer ?? new WriteTransactionService({ fileSystem, ids: systemIdGenerator, clock: systemClock }),
    },
    runner,
  });
  if (overrides.prepareAttempt !== undefined) workspace.prepareAttempt = overrides.prepareAttempt;
  return workspace;
}

/** Never settles: the engine that awaits it behaves like a process that died at that point. */
const hang = (): Promise<never> => new Promise<never>(() => undefined);

/** A crash point that tells the test when the engine got there (and so stopped writing). */
function crashPoint() {
  const state = { reached: false };
  return {
    hang: (): Promise<never> => {
      state.reached = true;
      return hang();
    },
    reached: () => state.reached,
  };
}

/** Worker output with raw, unvalidated paths: the workspace has to refuse unsafe ones itself. */
function creates(...files: readonly (readonly [string, string])[]): CoderOutput {
  return {
    operations: files.map(([path, content]) => ({ kind: 'create', path, content })),
    summary: 'files',
    assumptions: [],
  } as unknown as CoderOutput;
}

type Role = 'supervisor' | 'worker' | 'reviewer';
type Script = (input: unknown, envelope: AgentEnvelope) => unknown;

function kindOf(input: unknown): unknown {
  return typeof input === 'object' && input !== null && 'kind' in input ? input.kind : undefined;
}

function workerCreates(path: (envelope: AgentEnvelope) => string): Script {
  return (_input, envelope) => ({
    operations: [
      { kind: 'create', path: path(envelope), content: `export const attempt = '${envelope.attemptId}';\n` },
    ],
    summary: 'Create the file.',
    assumptions: [],
  });
}

const pass: Script = () => ({ verdict: 'pass', findings: [], summary: 'Looks good.' });
const approve: Script = () => ({ approveForOwner: true, summary: 'Ready for the owner.', risks: [] });

const CALL_COST = 10;

function scriptedAdapter(scripts: Partial<Record<Role, Script>>, calls: Role[] = []): IAgentExecutionAdapter {
  return {
    id: 'mock',
    probe: () => Promise.resolve({ status: 'available' as const }),
    capabilities: () => ({
      roles: ['supervisor', 'worker', 'reviewer'],
      structuredOutput: true,
      usage: true,
      cancel: true,
    }),
    run: async (envelope, input, signal) => {
      calls.push(envelope.roleId);
      const payload: unknown = await scripts[envelope.roleId]?.(input, envelope);
      if (signal.aborted)
        return { ok: false, error: { code: 'CANCELLED', message: 'Cancelled.', retryable: false } } as const;
      return {
        ok: true,
        value: {
          ack: {
            ack: true,
            roleId: envelope.roleId,
            taskId: envelope.taskId,
            attemptId: envelope.attemptId,
            allowedPaths: envelope.allowedPaths,
          },
          payload,
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cachedInputTokens: null,
            reasoningTokens: null,
            source: 'provider',
            costMicroUsd: CALL_COST as MicroUsd,
            billing: 'api',
          },
        },
      };
    },
  };
}

function taskSpec(id: string, overrides: Partial<OrchTaskSpec> = {}): OrchTask {
  return {
    id: id as OrchTask['id'],
    title: `Task ${id}`,
    objective: 'Do the work.',
    dependsOn: [],
    role: 'worker',
    candidateAgents: ['w'],
    allowedPaths: ['src/**'],
    testCommands: [],
    acceptanceCriteria: ['Done.'],
    estimate: 'S',
    timeoutMs: 60_000,
    ...overrides,
    state: 'ready',
    fixRounds: 0,
    attempts: [],
  };
}

function newRun(tasks: readonly OrchTask[]): OrchRun {
  return {
    id: randomUUID() as OrchRun['id'],
    projectId: PROJECT_ID,
    request: 'Stabilization regression',
    state: 'plan_ready',
    agents: [
      { agentId: 's', role: 'supervisor', transport: 'mock' },
      { agentId: 'w', role: 'worker', transport: 'mock' },
      { agentId: 'r', role: 'reviewer', transport: 'mock' },
    ],
    tasks,
    limits: {
      maxCostMicroUsd: 1_000_000 as MicroUsd,
      maxWallClockMs: 600_000,
      maxAgentCalls: 40,
      maxConcurrentWorkers: 1,
      maxFixRounds: 1,
      transientRetries: 0,
      hardStop: false,
    },
    targetBranch: 'main',
    costMicroUsd: 0 as MicroUsd,
    agentCalls: 0,
    createdAt: '2026-10-20T00:00:00.000Z' as OrchRun['createdAt'],
    updatedAt: '2026-10-20T00:00:00.000Z' as OrchRun['updatedAt'],
  };
}

type Handler = (params: { readonly runId: string }) => Promise<Result<OrchRun>>;

/** One "sidecar process": its own database connection, workspace caches and engine state. */
function sidecar(dataDir: string, root: string, adapter: IAgentExecutionAdapter, workspace = workspaceFor(root)) {
  const database = openDatabase(dataDir);
  connections.push(database.client);
  const repo = new OrchRepository(database.db);
  const mod = createOrchestrationModule({
    repository: repo,
    processes: { upsertOrchestration: () => undefined },
    validate: { workspaceRoot: root, allowedCommands: [] },
    createRun: () => {
      throw new Error('Runs are created by the test.');
    },
    adapters: [adapter],
    workspace,
    runner: new NodeProcessRunner(),
    projects: { get: () => Promise.resolve(project(root)) },
  });
  const handlers = new Map<string, Handler>();
  mod.register({ register: (method: string, handler: Handler) => handlers.set(method, handler) } as never);
  const call = (method: string, runId: string): Promise<Result<OrchRun>> => {
    const handler = handlers.get(method);
    if (handler === undefined) throw new Error(`missing ${method}`);
    return handler({ runId });
  };
  return { database, repo, mod, call };
}

function environment(files: Readonly<Record<string, string>> = { 'src/index.ts': 'export {};\n' }) {
  const root = repository(files);
  const dataDir = folder('itstudio-orch-db-');
  const first = openDatabase(dataDir);
  first.db
    .insert(projects)
    .values({ id: PROJECT_ID, name: 'Repo', workspaceRoot: root, createdAt: '2026-10-20T00:00:00.000Z' })
    .run();
  first.client.close();
  return { root, dataDir };
}

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function value(result: Result<OrchRun>): OrchRun {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function orchWorktrees(root: string): readonly string[] {
  return git(root, 'worktree', 'list', '--porcelain')
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('worktree ') && line.includes('.itstudio/orch'));
}

function expectNoDuplicateCharges(attempts: readonly OrchAttempt[], run: OrchRun): void {
  expect(new Set(attempts.map((attempt) => attempt.id)).size).toBe(attempts.length);
  const charged = attempts.reduce((sum, attempt) => sum + (attempt.usage.costMicroUsd ?? 0), 0);
  expect(run.costMicroUsd).toBe(charged);
  expect(attempts.filter((attempt) => attempt.state === 'running')).toEqual([]);
}

describe('P0-01 worker file application in a real worktree', () => {
  it(
    'P0-01 ORCH-006 applies nested files under src/** and refuses traversal, absolute and junction paths',
    async () => {
      const root = repository({ 'src/index.ts': 'export {};\n' });
      const outside = folder('itstudio-orch-outside-');
      const workspace = workspaceFor(root);
      const run = newRun([taskSpec('T1')]);
      const task = run.tasks[0];
      if (task === undefined) throw new Error('missing task');

      const first = await workspace.prepareAttempt(run, task, 1);
      if (!first.ok) throw new Error(first.error.message);
      const applied = await workspace.applyWorker(
        run,
        task,
        1,
        first.value,
        creates(
          ['src/ui/Button.tsx', 'export const Button = 1;\n'],
          ['src/ui/pages/App.tsx', 'export const App = 1;\n'],
        ),
      );
      if (!applied.ok) throw new Error(applied.error.message);
      expect([...applied.value.changedFiles].sort()).toEqual(['src/ui/Button.tsx', 'src/ui/pages/App.tsx']);
      expect(git(first.value.path, 'show', 'HEAD:src/ui/pages/App.tsx')).toBe('export const App = 1;');

      const second = await workspace.prepareAttempt(run, task, 2);
      if (!second.ok) throw new Error(second.error.message);
      symlinkSync(outside, join(second.value.path, 'src', 'link'), 'junction');
      const head = git(second.value.path, 'rev-parse', 'HEAD');
      for (const path of [
        'src/../outside.ts',
        '../outside.ts',
        'C:/outside.ts',
        '/outside.ts',
        'src\\..\\..\\outside.ts',
        'src/.git/hooks/pre-commit',
        'src/link/evil.ts',
      ]) {
        const denied = await workspace.applyWorker(run, task, 2, second.value, creates([path, 'pwned\n']));
        expect(denied.ok, path).toBe(false);
      }
      expect(existsSync(join(outside, 'evil.ts'))).toBe(false);
      expect(existsSync(join(root, 'outside.ts'))).toBe(false);
      expect(git(second.value.path, 'rev-parse', 'HEAD')).toBe(head);
    },
    LONG,
  );

  it(
    'P0-01 a run whose worker writes nested src/** files reaches the owner and merges them',
    async () => {
      const { root, dataDir } = environment();
      const adapter = scriptedAdapter({
        worker: workerCreates(() => 'src/ui/pages/App.tsx'),
        reviewer: pass,
        supervisor: approve,
      });
      const app = sidecar(dataDir, root, adapter);
      const run = newRun([taskSpec('T1')]);
      app.repo.save(run);
      const ready = value(await app.call('orch.start', run.id));
      expect(ready.state).toBe('awaiting_approval');
      const done = value(await app.call('orch.approve', run.id));
      expect(done.state).toBe('completed');
      expect(read(root, 'src/ui/pages/App.tsx')).toContain('export const attempt');
      expect(orchWorktrees(root)).toEqual([]);
    },
    LONG,
  );
});

describe('P1-01 crash recovery and resume', () => {
  const crashPoints = [
    {
      name: 'before worker execution',
      crash: (root: string, at: ReturnType<typeof crashPoint>) => ({
        workspace: workspaceFor(root, { prepareAttempt: at.hang }),
        scripts: {},
      }),
    },
    {
      name: 'during worker execution',
      crash: (root: string, at: ReturnType<typeof crashPoint>) => ({
        workspace: workspaceFor(root),
        scripts: { worker: at.hang },
      }),
    },
    {
      name: 'during file application',
      crash: (root: string, at: ReturnType<typeof crashPoint>) => ({
        workspace: workspaceFor(root, { writer: { prepare: at.hang } }),
        scripts: {},
      }),
    },
    {
      name: 'after worker execution, before its result was saved',
      crash: (root: string, at: ReturnType<typeof crashPoint>) => ({
        workspace: workspaceFor(root, { commands: { run: at.hang } }),
        scripts: {},
      }),
    },
  ] as const;
  const validation: CommandSpec = {
    kind: 'build',
    executable: 'node',
    args: ['-e', 'process.exit(0)'],
    timeoutMs: 60_000,
  };

  for (const point of crashPoints) {
    it(
      `P1-01 ORCH-012 crash ${point.name}: interrupted, resumed with a new attempt, merged exactly once`,
      async () => {
        const { root, dataDir } = environment();
        const run = newRun([taskSpec('T1', { testCommands: [validation] })]);
        const at = crashPoint();
        const crashing = point.crash(root, at);
        const before = sidecar(
          dataDir,
          root,
          scriptedAdapter({
            worker: workerCreates(() => 'src/feature.ts'),
            reviewer: pass,
            supervisor: approve,
            ...crashing.scripts,
          }),
          crashing.workspace,
        );
        before.repo.save(run);
        void before.call('orch.start', run.id);
        await until(at.reached, `the crash point ${point.name}`);

        // "Restart": a new process on the same database. The sweep never calls an agent by itself.
        const calls: Role[] = [];
        const after = sidecar(
          dataDir,
          root,
          scriptedAdapter(
            { worker: workerCreates(() => 'src/feature.ts'), reviewer: pass, supervisor: approve },
            calls,
          ),
        );
        after.mod.recoverInterrupted();
        after.mod.recoverInterrupted();
        const interrupted = after.repo.get(run.id);
        expect(interrupted?.state).toBe('paused_interrupted');
        expect(interrupted?.tasks[0]?.state).toBe('queued');
        expect(after.repo.attempts(run.id).map((attempt) => attempt.state)).toEqual(['unknown']);
        expect(calls).toEqual([]);

        const resumed = value(await after.call('orch.resume', run.id));
        expect(resumed.state).toBe('awaiting_approval');
        const attempts = after.repo.attempts(run.id);
        const workers = attempts.filter((attempt) => attempt.role === 'worker');
        expect(workers.map((attempt) => attempt.state)).toEqual(['unknown', 'succeeded']);
        expect(new Set(workers.map((attempt) => attempt.id)).size).toBe(2);
        expectNoDuplicateCharges(attempts, resumed);

        const done = value(await after.call('orch.approve', run.id));
        expect(done.state).toBe('completed');
        // Only the resumed attempt's change was merged, once.
        expect(read(root, 'src/feature.ts')).toBe(`export const attempt = '${workers[1]?.id ?? ''}';\n`);
        expect(git(root, 'rev-list', '--count', '--merges', '--first-parent', 'HEAD')).toBe('1');
        expect(orchWorktrees(root)).toEqual([]);
        expect(git(root, 'branch', '--list', 'itstudio/orch/*')).toBe('');
      },
      LONG,
    );
  }

  it(
    'P1-01 crash during review: the finished worker attempt is reviewed again, not redone',
    async () => {
      const { root, dataDir } = environment();
      const run = newRun([taskSpec('T1')]);
      const at = crashPoint();
      const before = sidecar(
        dataDir,
        root,
        scriptedAdapter({ worker: workerCreates(() => 'src/feature.ts'), reviewer: at.hang, supervisor: approve }),
      );
      before.repo.save(run);
      void before.call('orch.start', run.id);
      await until(at.reached, 'the review');
      const calls: Role[] = [];
      const after = sidecar(
        dataDir,
        root,
        scriptedAdapter({ worker: workerCreates(() => 'src/feature.ts'), reviewer: pass, supervisor: approve }, calls),
      );
      after.mod.recoverInterrupted();
      const resumed = value(await after.call('orch.resume', run.id));
      expect(resumed.state).toBe('awaiting_approval');
      expect(calls).toEqual(['reviewer', 'supervisor']);
      expectNoDuplicateCharges(after.repo.attempts(run.id), resumed);
      expect(value(await after.call('orch.approve', run.id)).state).toBe('completed');
      expect(read(root, 'src/feature.ts')).toContain('export const attempt');
    },
    LONG,
  );

  it(
    'P1-01 crash during integration: the integration branch is rebuilt, completed tasks are not redone',
    async () => {
      const { root, dataDir } = environment();
      const run = newRun([taskSpec('T1')]);
      const at = crashPoint();
      const before = sidecar(
        dataDir,
        root,
        scriptedAdapter({ worker: workerCreates(() => 'src/feature.ts'), reviewer: pass, supervisor: at.hang }),
      );
      before.repo.save(run);
      void before.call('orch.start', run.id);
      await until(at.reached, 'the final review');
      expect(git(root, 'branch', '--list', `itstudio/orch/${run.id}/integration`)).not.toBe('');
      const calls: Role[] = [];
      const after = sidecar(
        dataDir,
        root,
        scriptedAdapter({ worker: workerCreates(() => 'src/feature.ts'), reviewer: pass, supervisor: approve }, calls),
      );
      after.mod.recoverInterrupted();
      const resumed = value(await after.call('orch.resume', run.id));
      expect(resumed.state).toBe('awaiting_approval');
      expect(calls).toEqual(['supervisor']);
      expect(value(await after.call('orch.approve', run.id)).state).toBe('completed');
      expect(read(root, 'src/feature.ts')).toContain('export const attempt');
    },
    LONG,
  );

  it(
    'P1-01 crash while awaiting approval: the run stays reviewable and approves after restart',
    async () => {
      const { root, dataDir } = environment();
      const run = newRun([taskSpec('T1')]);
      const scripts = { worker: workerCreates(() => 'src/feature.ts'), reviewer: pass, supervisor: approve };
      const before = sidecar(dataDir, root, scriptedAdapter(scripts));
      before.repo.save(run);
      expect(value(await before.call('orch.start', run.id)).state).toBe('awaiting_approval');
      const after = sidecar(dataDir, root, scriptedAdapter(scripts));
      after.mod.recoverInterrupted();
      expect(after.repo.get(run.id)?.state).toBe('awaiting_approval');
      expect(value(await after.call('orch.approve', run.id)).state).toBe('completed');
      expect(read(root, 'src/feature.ts')).toContain('export const attempt');
    },
    LONG,
  );

  it(
    'P1-01 repeated and concurrent resume requests start the engine once',
    async () => {
      const { root, dataDir } = environment();
      const run = newRun([taskSpec('T1')]);
      const at = crashPoint();
      const before = sidecar(dataDir, root, scriptedAdapter({ worker: at.hang }));
      before.repo.save(run);
      void before.call('orch.start', run.id);
      await until(at.reached, 'the worker call');
      const calls: Role[] = [];
      const after = sidecar(
        dataDir,
        root,
        scriptedAdapter({ worker: workerCreates(() => 'src/feature.ts'), reviewer: pass, supervisor: approve }, calls),
      );
      after.mod.recoverInterrupted();
      const [a, b] = await Promise.all([after.call('orch.resume', run.id), after.call('orch.resume', run.id)]);
      expect([a.ok, b.ok].sort()).toEqual([false, true]);
      expect(calls.filter((role) => role === 'worker')).toHaveLength(1);
      const again = await after.call('orch.resume', run.id);
      expect(again.ok).toBe(false);
      expect(calls.filter((role) => role === 'worker')).toHaveLength(1);
    },
    LONG,
  );
});

function conflictRun(): OrchRun {
  return newRun([
    taskSpec('T1', { allowedPaths: ['src/shared.ts'] }),
    taskSpec('T2', { allowedPaths: ['src/shared.ts'] }),
  ]);
}

const SHARED = 'export const shared = [\n  "base",\n];\n';

function replaceShared(envelope: AgentEnvelope): unknown {
  const line = envelope.taskId === 'T1' ? '"one"' : '"two"';
  return {
    operations: [
      {
        kind: 'replace',
        path: 'src/shared.ts',
        baseHash: createHash('sha256').update(SHARED).digest('hex'),
        content: `export const shared = [\n  ${line},\n];\n`,
      },
    ],
    summary: 'Change the shared list.',
    assumptions: [],
  };
}

const BOTH = 'export const shared = [\n  "one",\n  "two",\n];\n';
/** Passes in every task worktree and in integration unless a conflict marker is left. */
const noMarkers: CommandSpec = {
  kind: 'build',
  executable: 'node',
  args: ['-e', 'process.exit(require("fs").readFileSync("src/shared.ts","utf8").includes("<<<<<<<")?1:0)'],
  timeoutMs: 60_000,
};

describe('P1-02 integration merge conflicts', () => {
  it(
    'P1-02 resolves a real Git conflict through an engine-applied resolution, then re-validates',
    async () => {
      const { root, dataDir } = environment({ 'src/shared.ts': SHARED });
      const conflicts: unknown[] = [];
      const app = sidecar(
        dataDir,
        root,
        scriptedAdapter({
          worker: (_input, envelope) => replaceShared(envelope),
          reviewer: (input) => {
            if (kindOf(input) !== 'integration-conflict') return pass(input, {} as AgentEnvelope);
            conflicts.push(input);
            return { resolutions: [{ path: 'src/shared.ts', content: BOTH }], summary: 'Keep both entries.' };
          },
          supervisor: approve,
        }),
      );
      const run = {
        ...conflictRun(),
        tasks: conflictRun().tasks.map((task) => ({ ...task, testCommands: [noMarkers] })),
      };
      app.repo.save(run);
      const ready = value(await app.call('orch.start', run.id));
      expect(ready.state).toBe('awaiting_approval');
      expect(conflicts).toHaveLength(1);
      expect(JSON.stringify(conflicts[0])).toContain('<<<<<<<');
      const integration = join(root, '.itstudio', 'orch', run.id, 'integration');
      expect(git(integration, 'ls-files', '-u')).toBe('');
      expect(gitStatus(integration, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).not.toBe(0);
      const finalReview = app.repo.attempts(run.id).find((attempt) => attempt.role === 'supervisor');
      expect(finalReview?.evidence.map((item) => item.exitCode)).toEqual([0]);

      expect(value(await app.call('orch.approve', run.id)).state).toBe('completed');
      expect(read(root, 'src/shared.ts')).toBe(BOTH);
    },
    LONG,
  );

  for (const [name, resolution] of [
    ['a textual "pass" verdict', { verdict: 'pass', findings: [], summary: 'Resolved.' }],
    [
      'content that still has conflict markers',
      { resolutions: [{ path: 'src/shared.ts', content: '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x\n' }], summary: 'x' },
    ],
    [
      'a file outside the conflicted set',
      {
        resolutions: [
          { path: 'src/shared.ts', content: BOTH },
          { path: 'src/other.ts', content: 'export const other = 1;\n' },
        ],
        summary: 'x',
      },
    ],
  ] as const) {
    it(
      `P1-02 escalates instead of merging when the reviewer returns ${name}`,
      async () => {
        const { root, dataDir } = environment({ 'src/shared.ts': SHARED });
        const app = sidecar(
          dataDir,
          root,
          scriptedAdapter({
            worker: (_input, envelope) => replaceShared(envelope),
            reviewer: (input) =>
              kindOf(input) === 'integration-conflict' ? resolution : pass(input, {} as AgentEnvelope),
            supervisor: approve,
          }),
        );
        const run = conflictRun();
        app.repo.save(run);
        const paused = value(await app.call('orch.start', run.id));
        expect(paused.state).toBe('paused');
        expect(paused.stateReason).toBe('INTEGRATION_CONFLICT');
        const integration = join(root, '.itstudio', 'orch', run.id, 'integration');
        expect(git(integration, 'ls-files', '-u')).toBe('');
        expect(gitStatus(integration, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).not.toBe(0);
        expect(git(integration, 'status', '--porcelain', '--untracked-files=no')).toBe('');
        const conflict = app.repo
          .attempts(run.id)
          .find((attempt) => attempt.role === 'reviewer' && attempt.changedFiles.includes('src/shared.ts'));
        expect(conflict?.state).toBe('failed');
        expect((await app.call('orch.approve', run.id)).ok).toBe(false);
        expect(read(root, 'src/shared.ts')).toBe(SHARED);
        expect(existsSync(join(root, 'src', 'other.ts'))).toBe(false);
      },
      LONG,
    );
  }
});

describe('P1-03 owner approval against stale branch state', () => {
  async function awaiting(files: Readonly<Record<string, string>> = { 'src/index.ts': 'export {};\n' }) {
    const { root, dataDir } = environment(files);
    const app = sidecar(
      dataDir,
      root,
      scriptedAdapter({ worker: workerCreates(() => 'src/feature.ts'), reviewer: pass, supervisor: approve }),
    );
    const run = newRun([taskSpec('T1')]);
    app.repo.save(run);
    const ready = value(await app.call('orch.start', run.id));
    expect(ready.state).toBe('awaiting_approval');
    return { root, app, ready };
  }

  it(
    'P1-03 unchanged target: merges exactly the reviewed integration commit',
    async () => {
      const { root, app, ready } = await awaiting();
      expect(ready.integrationHeadSha).toMatch(/^[0-9a-f]{40}$/u);
      expect(ready.integrationBaseSha).toBe(git(root, 'rev-parse', 'HEAD'));
      expect(value(await app.call('orch.approve', ready.id)).state).toBe('completed');
      expect(git(root, 'rev-parse', 'HEAD^1')).toBe(ready.integrationBaseSha);
      expect(git(root, 'rev-parse', 'HEAD^2')).toBe(ready.integrationHeadSha);
      expect(git(root, 'rev-parse', 'HEAD^{tree}')).toBe(
        git(root, 'rev-parse', `${ready.integrationHeadSha ?? ''}^{tree}`),
      );
    },
    LONG,
  );

  it(
    'P1-03 target advanced: approval is refused, the run needs a fresh integration and review',
    async () => {
      const { root, app, ready } = await awaiting();
      writeFileSync(join(root, 'owner.txt'), 'owner change\n');
      git(root, 'add', 'owner.txt');
      git(root, 'commit', '-q', '-m', 'owner work');
      const ownerHead = git(root, 'rev-parse', 'HEAD');
      const refused = await app.call('orch.approve', ready.id);
      expect(refused.ok).toBe(false);
      expect(git(root, 'rev-parse', 'HEAD')).toBe(ownerHead);
      const stale = app.repo.get(ready.id);
      expect(stale?.state).toBe('paused');
      expect(stale?.stateReason).toBe('TARGET_CHANGED');
      expect((await app.call('orch.approve', ready.id)).ok).toBe(false);

      const refreshed = value(await app.call('orch.resume', ready.id));
      expect(refreshed.state).toBe('awaiting_approval');
      expect(refreshed.integrationBaseSha).toBe(ownerHead);
      expect(value(await app.call('orch.approve', ready.id)).state).toBe('completed');
      expect(read(root, 'owner.txt')).toBe('owner change\n');
      expect(read(root, 'src/feature.ts')).toContain('export const attempt');
      expect(git(root, 'rev-parse', 'HEAD^2')).toBe(refreshed.integrationHeadSha);
    },
    LONG,
  );

  it(
    'P1-03 dirty file touched by the merge: approval refused and the owner change kept',
    async () => {
      const { root, app, ready } = await awaiting();
      writeFileSync(join(root, 'src', 'feature.ts'), 'owner draft\n');
      const refused = await app.call('orch.approve', ready.id);
      expect(refused.ok).toBe(false);
      expect(read(root, 'src/feature.ts')).toBe('owner draft\n');
      expect(app.repo.get(ready.id)?.state).toBe('awaiting_approval');
      expect(git(root, 'rev-list', '--count', '--merges', 'HEAD')).toBe('0');
    },
    LONG,
  );

  it(
    'P1-03 concurrent approvals merge once; repeated approval after completion is refused',
    async () => {
      const { root, app, ready } = await awaiting();
      const [a, b] = await Promise.all([app.call('orch.approve', ready.id), app.call('orch.approve', ready.id)]);
      expect([a.ok, b.ok].sort()).toEqual([false, true]);
      expect(git(root, 'rev-list', '--count', '--merges', '--first-parent', 'HEAD')).toBe('1');
      expect((await app.call('orch.approve', ready.id)).ok).toBe(false);
      expect(git(root, 'rev-list', '--count', '--merges', '--first-parent', 'HEAD')).toBe('1');
    },
    LONG,
  );

  it(
    'P1-03 merge failure leaves the target branch and working tree untouched',
    async () => {
      const { root, app, ready } = await awaiting();
      const head = git(root, 'rev-parse', 'HEAD');
      writeFileSync(join(root, '.git', 'hooks', 'pre-merge-commit'), '#!/bin/sh\nexit 1\n');
      const refused = await app.call('orch.approve', ready.id);
      expect(refused.ok).toBe(false);
      expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
      expect(gitStatus(root, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).not.toBe(0);
      expect(git(root, 'status', '--porcelain')).toBe('');
      expect(app.repo.get(ready.id)?.state).toBe('awaiting_approval');
    },
    LONG,
  );

  it(
    'P1-03 a failed cleanup after a successful merge does not undo the completed state',
    async () => {
      const { root, app, ready } = await awaiting();
      git(root, 'worktree', 'lock', join(root, '.itstudio', 'orch', ready.id, 'integration'));
      const done = value(await app.call('orch.approve', ready.id));
      expect(done.state).toBe('completed');
      expect(done.stateReason).toBe('CLEANUP_INCOMPLETE');
      expect(read(root, 'src/feature.ts')).toContain('export const attempt');
      expect((await app.call('orch.approve', ready.id)).ok).toBe(false);
      expect(git(root, 'rev-list', '--count', '--merges', '--first-parent', 'HEAD')).toBe('1');
    },
    LONG,
  );
});
