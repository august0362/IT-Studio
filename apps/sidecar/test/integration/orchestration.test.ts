import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import type { CommandRunId, FileOperation, MicroUsd, OrchAttempt, OrchRun, ProjectId } from '@itstudio/schemas';
import type { PreparedWriteTransaction } from '../../src/services/write-transaction.js';
import { MockAgentAdapter } from '../../src/modules/orchestration/adapters/mock-adapter.js';
import { OrchestrationEngine } from '../../src/modules/orchestration/engine.js';
import { createOrchestrationModule } from '../../src/modules/orchestration/index.js';
import { OrchWorkspace } from '../../src/modules/orchestration/workspace.js';
import { WorktreeManager } from '../../src/modules/orchestration/worktrees.js';
import { NodeProcessRunner } from '../../src/infra/node-process-runner.js';
import { NodeFileSystem } from '../../src/infra/node-file-system.js';
import type { OrchRepository } from '../../src/modules/orchestration/storage/orch-repository.js';
describe('orchestration integration smoke', () => {
  it('ORCH-001 plans, starts and reaches awaiting_approval after mock review pass', async () => {
    const engine = new OrchestrationEngine({
      adapters: new Map([
        [
          'mock',
          new MockAgentAdapter({
            reviewer: () => Promise.resolve({ verdict: 'pass', findings: [], summary: 'ok' }),
          }),
        ],
      ]),
      validate: { workspaceRoot: '/workspace', allowedCommands: [] },
    });
    const validated = await engine.plan({
      tasks: [
        {
          id: 'T1',
          title: 'smoke',
          objective: 'complete',
          dependsOn: [],
          role: 'worker',
          candidateAgents: ['w'],
          allowedPaths: ['src/**'],
          testCommands: [],
          acceptanceCriteria: ['done'],
          estimate: 'S',
          timeoutMs: 1000,
        },
      ],
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error('plan invalid');
    const spec = validated.value[0];
    if (spec === undefined) throw new Error('missing task');
    const run: OrchRun = {
      id: 'run-1' as OrchRun['id'],
      projectId: 'project-1' as OrchRun['projectId'],
      request: 'smoke',
      state: 'plan_ready',
      agents: [
        { agentId: 's', role: 'supervisor', transport: 'mock' },
        { agentId: 'w', role: 'worker', transport: 'mock' },
        { agentId: 'w2', role: 'worker', transport: 'mock' },
        { agentId: 'r', role: 'reviewer', transport: 'mock' },
      ],
      tasks: [{ ...spec, state: 'ready', fixRounds: 0, attempts: [] }],
      limits: {
        maxCostMicroUsd: 2_000_000 as OrchRun['limits']['maxCostMicroUsd'],
        maxWallClockMs: 3_600_000,
        maxAgentCalls: 40,
        maxConcurrentWorkers: 2,
        maxFixRounds: 2,
        transientRetries: 1,
        hardStop: false,
      },
      targetBranch: 'main',
      costMicroUsd: 0 as OrchRun['costMicroUsd'],
      agentCalls: 0,
      createdAt: new Date().toISOString() as OrchRun['createdAt'],
      updatedAt: new Date().toISOString() as OrchRun['updatedAt'],
    };
    const result = await engine.run(run);
    expect(result.state).toBe('awaiting_approval');
    expect(engine.attempts(run.id).map((attempt) => attempt.role)).toEqual(['worker', 'reviewer', 'supervisor']);
  });
  it('ORCH-009 retries once after fix_required and pauses after the bounded fix rounds', async () => {
    const engine = new OrchestrationEngine({
      adapters: new Map([
        [
          'mock',
          new MockAgentAdapter({
            reviewer: () =>
              Promise.resolve({
                verdict: 'fix_required',
                findings: [{ severity: 'error', path: 'src/a.ts', message: 'issue', suggestedFix: 'correct it' }],
                summary: 'fix',
              }),
            supervisor: () => Promise.resolve({ decision: 'reassign' }),
          }),
        ],
      ]),
      validate: { workspaceRoot: '/workspace', allowedCommands: [] },
      id: (() => {
        let id = 0;
        return () => `attempt-${String(++id)}`;
      })(),
    });
    const spec = {
      id: 'T1' as OrchRun['tasks'][number]['id'],
      title: 'task',
      objective: 'work',
      dependsOn: [],
      role: 'worker' as const,
      candidateAgents: ['w'],
      allowedPaths: ['src/**'],
      testCommands: [],
      acceptanceCriteria: ['done'],
      estimate: 'S' as const,
      timeoutMs: 1000,
    };
    const now = new Date().toISOString() as OrchRun['createdAt'];
    const run: OrchRun = {
      id: 'run-fix' as OrchRun['id'],
      projectId: 'project-1' as OrchRun['projectId'],
      request: 'fix',
      state: 'plan_ready',
      agents: [
        { agentId: 's', role: 'supervisor', transport: 'mock' },
        { agentId: 'w', role: 'worker', transport: 'mock' },
        { agentId: 'w2', role: 'worker', transport: 'mock' },
        { agentId: 'r', role: 'reviewer', transport: 'mock' },
      ],
      tasks: [{ ...spec, state: 'ready', fixRounds: 0, attempts: [] }],
      limits: {
        maxCostMicroUsd: 2_000_000 as OrchRun['limits']['maxCostMicroUsd'],
        maxWallClockMs: 3_600_000,
        maxAgentCalls: 40,
        maxConcurrentWorkers: 2,
        maxFixRounds: 1,
        transientRetries: 1,
        hardStop: false,
      },
      targetBranch: 'main',
      costMicroUsd: 0 as OrchRun['costMicroUsd'],
      agentCalls: 0,
      createdAt: now,
      updatedAt: now,
    };
    const result = await engine.run(run);
    expect(result.state).toBe('paused');
    expect(result.stateReason).toBe('NEEDS_OWNER');
    expect(engine.attempts(run.id).filter((attempt) => attempt.role === 'worker')).toHaveLength(2);
    expect(engine.attempts(run.id).filter((attempt) => attempt.role === 'supervisor')).toHaveLength(1);
  });

  it('ORCH-013 (integration) user has uncommitted change; unrelated changes untouched after integration and merge', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'orch-test-repo-'));
    const runner = new NodeProcessRunner();
    try {
      mkdirSync(join(repoDir, 'src'), { recursive: true });
      writeFileSync(join(repoDir, 'src', 'initial.ts'), 'export const a = 1;\n');
      writeFileSync(join(repoDir, 'unrelated.txt'), 'unrelated original\n');

      await runner.run({
        executable: 'git',
        args: ['init', '-b', 'main'],
        cwd: repoDir,
        env: process.env,
        timeoutMs: 10_000,
      });
      await runner.run({
        executable: 'git',
        args: ['config', 'user.email', 'test@example.com'],
        cwd: repoDir,
        env: process.env,
        timeoutMs: 10_000,
      });
      await runner.run({
        executable: 'git',
        args: ['config', 'user.name', 'Test User'],
        cwd: repoDir,
        env: process.env,
        timeoutMs: 10_000,
      });
      await runner.run({
        executable: 'git',
        args: ['config', 'core.autocrlf', 'false'],
        cwd: repoDir,
        env: process.env,
        timeoutMs: 10_000,
      });
      await runner.run({
        executable: 'git',
        args: ['config', 'commit.gpgsign', 'false'],
        cwd: repoDir,
        env: process.env,
        timeoutMs: 10_000,
      });
      await runner.run({ executable: 'git', args: ['add', '.'], cwd: repoDir, env: process.env, timeoutMs: 10_000 });
      await runner.run({
        executable: 'git',
        args: ['commit', '-m', 'initial commit'],
        cwd: repoDir,
        env: process.env,
        timeoutMs: 10_000,
      });

      // Unrelated uncommitted modification
      writeFileSync(join(repoDir, 'unrelated.txt'), 'unrelated modified\n');

      const runs = new Map<string, OrchRun>();
      const attempts = new Map<string, OrchAttempt[]>();
      const repo = {
        save: (run: OrchRun, atts: readonly OrchAttempt[] = []) => {
          runs.set(run.id, run);
          const existing = attempts.get(run.id) ?? [];
          for (const a of atts) {
            if (!existing.some((e) => e.id === a.id)) existing.push(a);
          }
          attempts.set(run.id, existing);
        },
        get: (id: string) => runs.get(id),
        list: () => Array.from(runs.values()),
        attempts: (id: string) => attempts.get(id) ?? [],
      } as unknown as OrchRepository;

      const worktrees = new WorktreeManager(runner);
      const fileSystem = new NodeFileSystem();
      const workspace = new OrchWorkspace({
        projects: {
          get: () =>
            Promise.resolve({
              id: 'project-1' as ProjectId,
              workspaceRoot: repoDir,
              name: 'Repo',
              createdAt: '2026-01-01T00:00:00.000Z' as OrchRun['createdAt'],
              archived: false,
            }),
        },
        worktrees,
        apply: {
          runner,
          fileSystem,
          commands: {
            run: () =>
              Promise.resolve({
                ok: true,
                value: {
                  id: 'cmd-1' as CommandRunId,
                  spec: { kind: 'test', executable: 'node', args: [], timeoutMs: 1000 },
                  exitCode: 0,
                  stdoutTail: '',
                  stderrTail: '',
                  timedOut: false,
                  durationMs: 1,
                  diagnostics: [],
                },
              }),
          },
          writer: {
            prepare: async (root: string, _p: ProjectId, ops: readonly FileOperation[]) => {
              await Promise.resolve();
              for (const op of ops) {
                if (op.kind === 'create' || op.kind === 'replace') {
                  const fullPath = join(root, op.path);
                  mkdirSync(dirname(fullPath), { recursive: true });
                  writeFileSync(fullPath, op.content);
                }
              }
              return {
                ok: true,
                value: {
                  commit: () => Promise.resolve({ ok: true as const, value: undefined }),
                  markValidated: () => Promise.resolve({ ok: true as const, value: undefined }),
                } as unknown as PreparedWriteTransaction,
              };
            },
          },
        },
        runner,
      });

      const mod = createOrchestrationModule({
        repository: repo,
        processes: { upsertOrchestration: vi.fn() },
        validate: { workspaceRoot: repoDir, allowedCommands: [] },
        createRun: (projectId, request, tasks) => ({
          id: 'run-1' as OrchRun['id'],
          projectId,
          request,
          state: 'plan_ready',
          agents: [
            { agentId: 's', role: 'supervisor', transport: 'mock' },
            { agentId: 'w', role: 'worker', transport: 'mock' },
            { agentId: 'r', role: 'reviewer', transport: 'mock' },
          ],
          tasks: tasks.map((t) => ({ ...t, state: 'ready', fixRounds: 0, attempts: [] })),
          limits: {
            maxCostMicroUsd: 1_000_000 as MicroUsd,
            maxWallClockMs: 60_000,
            maxAgentCalls: 10,
            maxConcurrentWorkers: 1,
            maxFixRounds: 1,
            transientRetries: 0,
            hardStop: false,
          },
          targetBranch: 'main',
          costMicroUsd: 0 as MicroUsd,
          agentCalls: 0,
          createdAt: new Date().toISOString() as OrchRun['createdAt'],
          updatedAt: new Date().toISOString() as OrchRun['updatedAt'],
        }),
        scripts: {
          supervisor: () =>
            Promise.resolve({
              tasks: [
                {
                  id: 'T1',
                  title: 'task',
                  objective: 'work',
                  dependsOn: [],
                  role: 'worker',
                  candidateAgents: ['w'],
                  allowedPaths: ['src/**'],
                  testCommands: [],
                  acceptanceCriteria: ['done'],
                  estimate: 'S',
                  timeoutMs: 1000,
                },
              ],
            }),
          worker: () =>
            Promise.resolve({
              operations: [{ kind: 'create', path: 'src/feature.ts', content: 'export const feature = 2;\n' }],
              summary: 'Add feature',
              assumptions: [],
            }),
          reviewer: () => Promise.resolve({ verdict: 'pass', findings: [], summary: 'Pass' }),
        },
        workspace,
        runner,
        includeMock: true,
      });

      const rpcMap = new Map<string, (params: unknown) => Promise<{ ok: boolean; value?: OrchRun }>>();
      mod.register({
        register: (method: string, handler: (params: unknown) => Promise<{ ok: boolean; value?: OrchRun }>) => {
          rpcMap.set(method, handler);
        },
      } as never);

      const planHandler = rpcMap.get('orch.plan');
      if (!planHandler) throw new Error('missing orch.plan');
      const planRes = await planHandler({ projectId: 'project-1' as ProjectId, request: 'Add feature' });
      expect(planRes.ok).toBe(true);
      if (!planRes.value) throw new Error('plan failed');

      const startHandler = rpcMap.get('orch.start');
      if (!startHandler) throw new Error('missing orch.start');
      const startRes = await startHandler({ runId: planRes.value.id });
      expect(startRes.ok).toBe(true);
      expect(startRes.value?.state).toBe('awaiting_approval');

      const approveHandler = rpcMap.get('orch.approve');
      if (!approveHandler) throw new Error('missing orch.approve');
      const approveRes = await approveHandler({ runId: planRes.value.id });
      expect(approveRes.ok).toBe(true);
      expect(approveRes.value?.state).toBe('completed');

      // Verify Git state
      expect(readFileSync(join(repoDir, 'unrelated.txt'), 'utf8').replace(/\r\n/gu, '\n')).toBe('unrelated modified\n');
      expect(readFileSync(join(repoDir, 'src', 'feature.ts'), 'utf8').replace(/\r\n/gu, '\n')).toBe(
        'export const feature = 2;\n',
      );

      const log = await runner.run({
        executable: 'git',
        args: ['rev-list', '--count', '--merges', '--first-parent', 'HEAD'],
        cwd: repoDir,
        env: process.env,
        timeoutMs: 10_000,
      });
      expect(log.ok && log.value.stdoutTail.trim()).toBe('1');
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
