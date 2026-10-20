import { randomUUID } from 'node:crypto';
import {
  ErrorCode,
  type CommandSpec,
  type OrchAgentRef,
  type OrchAttempt,
  type OrchestrationSettings,
  type OrchLimits,
  type OrchRun,
  type OrchTaskSpec,
  type ProjectId,
  type Result,
} from '@itstudio/schemas';
import { MockAgentAdapter, type MockScript } from './adapters/mock-adapter.js';
import { OrchestrationEngine } from './engine.js';
import type { PlanValidationOptions } from './dag.js';
import type { OrchRepository } from './storage/orch-repository.js';
import type { RpcServer } from '../../kernel/rpc/rpc-server.js';
import type { ProcessRegistry } from '../processes/index.js';
import type { IAgentExecutionAdapter } from '../../kernel/ports/agent-execution.js';
import type { IOrchWorkspace } from './workspace.js';
import { isTargetForbidden } from './workspace.js';
import { interruptedAttempts, interruptedTasks } from './recovery.js';
import { runWorktrees } from './worktrees.js';
import type { IProcessRunner } from '../../kernel/ports/process-runner.js';
import type { IProjectLifecycleRepository } from '../../kernel/ports/project-repository.js';

export interface OrchestrationModuleDependencies {
  readonly repository: OrchRepository;
  readonly processes: Pick<ProcessRegistry, 'upsertOrchestration'>;
  readonly validate: PlanValidationOptions;
  readonly createRun: (
    projectId: ProjectId,
    request: string,
    tasks: readonly OrchTaskSpec[],
    options?: RunCreationOptions,
  ) => OrchRun;
  /**
   * Owner settings for real runs. When present (and mock agents are not enabled) planning calls the
   * configured supervisor agent and runs use the configured agents and limits.
   */
  readonly settings?: () => Promise<Result<OrchestrationRunSettings>>;
  readonly scripts?: Partial<Record<'supervisor' | 'worker' | 'reviewer', MockScript>>;
  readonly adapters?: readonly IAgentExecutionAdapter[];
  readonly includeMock?: boolean;
  readonly publish?: (event: { readonly type: 'run'; readonly run: OrchRun }) => void;
  readonly workspace?: IOrchWorkspace;
  readonly runner?: IProcessRunner;
  readonly projects?: Pick<IProjectLifecycleRepository, 'get'>;
  readonly sidecarCwd?: string;
  readonly appExecutableDir?: string;
}

export interface RunCreationOptions {
  readonly id: string;
  readonly agents: readonly OrchAgentRef[];
  readonly limits: OrchLimits;
  readonly targetBranch: string;
}

export interface OrchestrationRunSettings {
  readonly orchestration: OrchestrationSettings;
  /** Commands a plan may use as task test commands (the project's validation commands). */
  readonly allowedCommands: readonly CommandSpec[];
}

const PLAN_TIMEOUT_MS = 600_000;

/** Plan of the scripted mock supervisor (tests and the E2E fixture). */
const MOCK_PLAN = {
  tasks: [
    {
      id: 'T1',
      title: 'Implement request',
      objective: 'Complete the requested work.',
      dependsOn: [],
      role: 'worker',
      candidateAgents: ['mock-worker'],
      allowedPaths: ['src/**'],
      testCommands: [],
      acceptanceCriteria: ['Request is complete.'],
      estimate: 'M',
      timeoutMs: 600_000,
    },
  ],
};

/** Distinct worker agents from the settings, in order (workerA and workerB may be the same agent). */
export function settingsWorkers(settings: OrchestrationSettings): readonly OrchAgentRef[] {
  const workers = [settings.roles.workerA, settings.roles.workerB];
  return workers.filter((worker, index) => workers.findIndex((item) => item.agentId === worker.agentId) === index);
}

/** Keeps only known worker ids in each task; a task naming none of them may use every worker. */
export function normalizeCandidates(
  tasks: readonly OrchTaskSpec[],
  workers: readonly OrchAgentRef[],
): readonly OrchTaskSpec[] {
  const ids = workers.map((worker) => worker.agentId);
  return tasks.map((task) => {
    const known = task.candidateAgents.filter((id) => ids.includes(id));
    return { ...task, candidateAgents: known.length > 0 ? known : ids };
  });
}

export function createOrchestrationModule(deps: OrchestrationModuleDependencies) {
  const scripts = {
    worker: () => Promise.resolve({ operations: [], summary: 'Done', assumptions: [] }),
    reviewer: () => Promise.resolve({ verdict: 'pass', findings: [], summary: 'Pass' }),
    supervisor: (input: unknown) =>
      Promise.resolve(
        typeof input === 'object' && input !== null && 'kind' in input && input.kind === 'final-review'
          ? { approveForOwner: true, summary: 'Mock final review: ready for the owner.', risks: [] }
          : MOCK_PLAN,
      ),
    ...deps.scripts,
  };
  const mockAdapter = new MockAgentAdapter(scripts);
  const adapterList = [...(deps.includeMock === true ? [mockAdapter] : []), ...(deps.adapters ?? [])];
  const adapterMap = new Map(adapterList.map((adapter) => [adapter.id, adapter]));
  const engine = new OrchestrationEngine({
    adapters: adapterMap,
    validate: deps.validate,
    // Attempt ids are primary keys across all runs; never reuse per-run counters.
    id: () => randomUUID(),
    ...(deps.workspace === undefined ? {} : { workspace: deps.workspace }),
    ...(deps.appExecutableDir === undefined ? {} : { appExecutableDir: deps.appExecutableDir }),
  });
  const activeRuns = new Map<string, Promise<OrchRun>>();
  const eventTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingEvents = new Map<string, { readonly type: 'run'; readonly run: OrchRun }>();

  function publish(event: { readonly type: 'run'; readonly run: OrchRun }): void {
    pendingEvents.set(event.run.id, event);
    if (eventTimers.has(event.run.id)) return;
    eventTimers.set(
      event.run.id,
      setTimeout(() => {
        eventTimers.delete(event.run.id);
        const pending = pendingEvents.get(event.run.id);
        pendingEvents.delete(event.run.id);
        if (pending !== undefined) deps.publish?.(pending);
      }, 100),
    );
  }

  async function plan(projectId: ProjectId, request: string): Promise<OrchRun | undefined> {
    const planResult = await engine.plan(
      await scripts.supervisor({ request }, { roleId: 'supervisor' } as Parameters<MockScript>[1]),
    );
    if (!planResult.ok) return undefined;
    const run = deps.createRun(projectId, request, planResult.value);
    deps.repository.save(run);
    deps.processes.upsertOrchestration(run);
    publish({ type: 'run', run });
    return run;
  }

  function forbidden(root: string): boolean {
    return isTargetForbidden(root, deps.sidecarCwd, deps.appExecutableDir);
  }

  /** Real planning: the configured supervisor agent plans; the run uses the configured agents and limits. */
  async function planWithAgents(
    projectId: ProjectId,
    request: string,
    readSettings: () => Promise<Result<OrchestrationRunSettings>>,
  ): Promise<Result<OrchRun>> {
    const settings = await readSettings();
    if (!settings.ok) return settings;
    if (deps.workspace?.projectInfo === undefined)
      return {
        ok: false,
        error: { code: ErrorCode.INTERNAL, message: 'Orchestration workspace is not configured.', retryable: false },
      };
    const info = await deps.workspace.projectInfo(projectId);
    if (!info.ok) return info;
    if (forbidden(info.value.root))
      return {
        ok: false,
        error: { code: ErrorCode.TARGET_FORBIDDEN, message: 'Target project path is forbidden.', retryable: false },
      };
    const { roles, limits } = settings.value.orchestration;
    const workers = settingsWorkers(settings.value.orchestration);
    const allowedCommands = settings.value.allowedCommands;
    const runId = randomUUID();
    const planned = await engine.supervisePlan(roles.supervisor, {
      projectId,
      runId,
      input: {
        kind: 'plan',
        request,
        workers: workers.map((worker) => worker.agentId),
        tree: info.value.tree,
        allowedCommands,
      },
      timeoutMs: PLAN_TIMEOUT_MS,
      validate: { workspaceRoot: info.value.root, allowedCommands },
    });
    if (!planned.plan.ok) return planned.plan;
    const run = deps.createRun(projectId, request, normalizeCandidates(planned.plan.value, workers), {
      id: runId,
      agents: [roles.supervisor, ...workers, roles.reviewer],
      limits,
      targetBranch: info.value.branch,
    });
    const counted: OrchRun = {
      ...run,
      agentCalls: run.agentCalls + 1,
      costMicroUsd: (run.costMicroUsd + (planned.attempt.usage.costMicroUsd ?? 0)) as OrchRun['costMicroUsd'],
    };
    deps.repository.save(counted, [planned.attempt]);
    deps.processes.upsertOrchestration(counted);
    publish({ type: 'run', run: counted });
    return { ok: true, value: counted };
  }

  function store(run: OrchRun, attempts: readonly OrchAttempt[] = []): void {
    deps.repository.save(run, attempts);
    deps.processes.upsertOrchestration(run);
    publish({ type: 'run', run });
  }

  /** Approvals in progress; with `activeRuns` they serialize every state change of a run in this process. */
  const approving = new Set<string>();
  const busy = (runId: string): boolean => activeRuns.has(runId) || approving.has(runId);
  const conflict = (message: string, remediation: string): Result<never> => ({
    ok: false,
    error: { code: ErrorCode.CONFLICT, message, remediation: [remediation], retryable: false },
  });

  /**
   * Startup sweep (ADR-0006 §8): a run left `running` by a dead process becomes `paused_interrupted`, its
   * in-flight tasks queued, its running attempts `unknown`. Nothing is relaunched: resuming is the owner's call.
   */
  function recoverInterrupted(): readonly OrchRun[] {
    const recovered: OrchRun[] = [];
    for (const run of deps.repository.list(undefined, 1_000)) {
      if (run.state !== 'running' || busy(run.id)) continue;
      const interrupted: OrchRun = {
        ...run,
        state: 'paused_interrupted',
        stateReason: 'INTERRUPTED',
        tasks: interruptedTasks(run.tasks),
      };
      store(interrupted, interruptedAttempts(deps.repository.attempts(run.id)));
      recovered.push(interrupted);
    }
    return recovered;
  }

  /** Runs the engine for a stored run, at most once at a time per run. */
  async function launch(runId: string): Promise<Result<OrchRun>> {
    if (busy(runId)) return conflict('This run is already being processed.', 'Wait for the current step to finish.');
    const current = deps.repository.get(runId);
    if (current === undefined)
      return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Run not found.', retryable: false } };
    // Registered synchronously, before the engine's first await, so a second request sees it.
    const running = engine.run(
      current,
      (updated, attempts) => {
        store(updated, attempts);
      },
      deps.repository.attempts(runId),
    );
    activeRuns.set(runId, running);
    try {
      const run = await running;
      store(run, engine.attempts(run.id));
      return { ok: true, value: run };
    } catch {
      // Never leave a run `running` with no engine behind it: make it resumable like after a crash.
      const latest = deps.repository.get(runId) ?? current;
      store(
        { ...latest, state: 'paused_interrupted', stateReason: 'ENGINE_ERROR', tasks: interruptedTasks(latest.tasks) },
        interruptedAttempts(deps.repository.attempts(runId)),
      );
      return {
        ok: false,
        error: {
          code: ErrorCode.INTERNAL,
          message: 'The orchestration engine stopped unexpectedly.',
          remediation: ['Open the run, check its attempts, then resume or discard it.'],
          retryable: false,
        },
      };
    } finally {
      activeRuns.delete(runId);
    }
  }

  async function start(runId?: string): Promise<OrchRun | undefined> {
    if (runId === undefined) {
      recoverInterrupted();
      return undefined;
    }
    const launched = await launch(runId);
    return launched.ok ? launched.value : undefined;
  }

  async function projectRoot(run: OrchRun): Promise<string> {
    const project = deps.projects !== undefined ? await deps.projects.get(run.projectId) : null;
    return project?.workspaceRoot ?? deps.validate.workspaceRoot;
  }

  /** Removes every worktree and branch of the run; `false` when one could not be removed. */
  async function removeRunWorktrees(run: OrchRun, attempts: readonly OrchAttempt[]): Promise<boolean> {
    if (deps.workspace === undefined) return true;
    // Git's own list also finds worktrees a crashed engine created but never recorded.
    const listed = await deps.workspace.runWorktrees?.(run);
    const worktrees =
      listed ??
      runWorktrees(
        await projectRoot(run),
        run.id,
        attempts.map((attempt) => attempt.worktree),
        run.integrationBranch,
      );
    let clean = true;
    for (const worktree of worktrees) {
      const removed = await deps.workspace.cleanup(run, worktree);
      if (!removed.ok) clean = false;
    }
    return clean;
  }

  async function git(cwd: string, args: readonly string[]) {
    if (deps.runner === undefined)
      return {
        ok: false as const,
        error: { code: ErrorCode.INTERNAL, message: 'No process runner.', retryable: false },
      };
    return deps.runner.run({ executable: 'git', args, cwd, env: process.env, timeoutMs: 30_000 });
  }

  async function gitOut(cwd: string, args: readonly string[]): Promise<string | undefined> {
    const result = await git(cwd, args);
    return result.ok && result.value.exitCode === 0 ? result.value.stdoutTail.trim() : undefined;
  }

  type ApprovalCheck =
    | { readonly kind: 'ok' }
    | { readonly kind: 'stale'; readonly reason: string; readonly message: string }
    | { readonly kind: 'blocked'; readonly error: Result<never> };

  /**
   * The owner approves what was reviewed: the integration commit that passed validation and the final review,
   * on top of the exact target commit it was built on. Anything else is stale or blocked, never merged.
   */
  async function checkApproval(run: OrchRun, root: string): Promise<ApprovalCheck> {
    const base = run.integrationBaseSha;
    const head = run.integrationHeadSha;
    const branch = run.integrationBranch ?? `itstudio/orch/${run.id}/integration`;
    if (base === undefined || head === undefined)
      return {
        kind: 'stale',
        reason: 'REVIEW_STALE',
        message: 'This run has no reviewed integration commit. Resume it to integrate, validate and review again.',
      };
    const checkedOut = await gitOut(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (checkedOut !== run.targetBranch)
      return {
        kind: 'blocked',
        error: conflict(
          `Check out ${run.targetBranch} in the project before approving (current: ${checkedOut ?? 'unknown'}).`,
          `Run "git checkout ${run.targetBranch}" in the project folder, then approve again.`,
        ),
      };
    if ((await gitOut(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])) !== undefined)
      return {
        kind: 'blocked',
        error: conflict(
          'A Git merge is in progress in the project.',
          'Finish or abort that merge ("git merge --abort"), then approve again.',
        ),
      };
    if ((await gitOut(root, ['rev-parse', 'HEAD'])) !== base)
      return {
        kind: 'stale',
        reason: 'TARGET_CHANGED',
        message: `${run.targetBranch} changed after the review. Resume the run to integrate, validate and review again.`,
      };
    if ((await gitOut(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])) !== head)
      return {
        kind: 'stale',
        reason: 'INTEGRATION_CHANGED',
        message: 'The integration branch changed after the review. Resume the run to review it again.',
      };
    const touched = await gitOut(root, ['diff', '--name-only', base, head]);
    if (touched === undefined)
      return { kind: 'blocked', error: conflict('Could not list the reviewed changes.', 'Try again.') };
    const files = touched.split(/\r?\n/u).filter((line) => line.length > 0);
    const dirty = files.length === 0 ? '' : await gitOut(root, ['status', '--porcelain', '--', ...files]);
    if (dirty !== '')
      return {
        kind: 'blocked',
        error: conflict(
          'Working tree has uncommitted changes in files this merge changes.',
          'Commit, stash or remove your changes to those files, then approve again.',
        ),
      };
    return { kind: 'ok' };
  }

  async function approve(runId: string): Promise<Result<OrchRun>> {
    const current = deps.repository.get(runId);
    if (current === undefined) {
      return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Run not found.', retryable: false } };
    }
    if (current.state !== 'awaiting_approval')
      return conflict('Run is not awaiting approval.', 'Open the run to see its current state.');
    const attempts = deps.repository.attempts(runId);
    let mergeVerified = true;
    if (deps.runner !== undefined) {
      const root = await projectRoot(current);
      const check = await checkApproval(current, root);
      if (check.kind === 'blocked') return check.error;
      if (check.kind === 'stale') {
        store({ ...current, state: 'paused', stateReason: check.reason });
        return conflict(check.message, 'Resume the run, then review and approve the new result.');
      }
      const head = current.integrationHeadSha ?? '';
      const merge = await git(root, [
        'merge',
        '--no-ff',
        '-m',
        `Merge IT Studio orchestration run ${current.id} (${current.integrationBranch ?? 'integration'})`,
        head,
      ]);
      if (!merge.ok || merge.value.exitCode !== 0) {
        // Never leave the owner's branch half-merged.
        if ((await gitOut(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])) !== undefined)
          await git(root, ['merge', '--abort']);
        return conflict(
          'Failed to merge integration branch into target branch.',
          'Check the project with "git status", then approve again.',
        );
      }
      const parents = await gitOut(root, ['rev-parse', 'HEAD^1', 'HEAD^2']);
      mergeVerified = parents?.split(/\r?\n/u).join(' ') === `${current.integrationBaseSha ?? ''} ${head}`;
    }
    // The merge is done: record it before cleanup, so a cleanup failure can never undo or repeat it.
    const completed: OrchRun = { ...current, state: 'completed' };
    Reflect.deleteProperty(completed, 'stateReason');
    const verified: OrchRun = mergeVerified ? completed : { ...completed, stateReason: 'MERGE_VERIFICATION_FAILED' };
    store(verified, attempts);
    const cleaned = await removeRunWorktrees(verified, attempts).catch(() => false);
    if (cleaned) return { ok: true, value: verified };
    const noted: OrchRun = { ...verified, stateReason: verified.stateReason ?? 'CLEANUP_INCOMPLETE' };
    store(noted, attempts);
    return { ok: true, value: noted };
  }

  function register(server: RpcServer): void {
    server.register('orch.adapters', async () => ({
      ok: true,
      value: await Promise.all(
        adapterList
          .filter((item) => item.id !== 'mock' || process.env.ITSTUDIO_E2E_ORCH_MOCK === '1')
          .map(async (adapter) => ({
            transport: adapter.id,
            ...(await adapter.probe()),
          })),
      ),
    }));

    server.register('orch.plan', async ({ projectId, request }) => {
      if (deps.includeMock !== true && deps.settings !== undefined)
        return await planWithAgents(projectId, request, deps.settings);
      const project = deps.projects !== undefined ? await deps.projects.get(projectId) : null;
      const workspaceRoot = project?.workspaceRoot ?? deps.validate.workspaceRoot;
      if (isTargetForbidden(workspaceRoot, deps.sidecarCwd, deps.appExecutableDir)) {
        return {
          ok: false,
          error: {
            code: ErrorCode.TARGET_FORBIDDEN,
            message: 'Target project path is forbidden.',
            retryable: false,
          },
        };
      }
      const run = await plan(projectId, request);
      return run === undefined
        ? { ok: false, error: { code: ErrorCode.PLAN_INVALID, message: 'Plan validation failed.', retryable: false } }
        : { ok: true, value: run };
    });

    server.register('orch.start', ({ runId }) => launch(runId));

    server.register('orch.get', ({ runId }) => {
      const run = deps.repository.get(runId);
      return Promise.resolve(
        run === undefined
          ? { ok: false as const, error: { code: ErrorCode.NOT_FOUND, message: 'Run not found.', retryable: false } }
          : { ok: true as const, value: run },
      );
    });

    server.register('orch.list', ({ projectId, limit }) =>
      Promise.resolve({ ok: true, value: deps.repository.list(projectId, limit) }),
    );

    server.register('orch.attempts', ({ runId }) =>
      Promise.resolve({ ok: true, value: deps.repository.attempts(runId) }),
    );

    server.register('orch.cancel', async ({ runId }) => {
      if (!engine.cancel(runId)) {
        return {
          ok: false,
          error: { code: ErrorCode.CONFLICT, message: 'The orchestration run is not active.', retryable: false },
        };
      }
      const completed = await activeRuns.get(runId);
      return completed === undefined
        ? {
            ok: false,
            error: { code: ErrorCode.INTERNAL, message: 'The cancelled run did not finish.', retryable: false },
          }
        : { ok: true, value: completed };
    });

    server.register('orch.resume', async ({ runId }) => {
      const current = deps.repository.get(runId);
      if (current === undefined) {
        return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Run not found.', retryable: false } };
      }
      if (busy(runId)) return conflict('This run is already being processed.', 'Wait for the current step to finish.');
      if (current.state !== 'paused' && current.state !== 'paused_interrupted') {
        return conflict('Run is not paused.', 'Only a paused or interrupted run can be resumed.');
      }
      return await launch(runId);
    });

    server.register('orch.approve', async ({ runId }) => {
      if (busy(runId)) return conflict('This run is already being processed.', 'Wait for the current step to finish.');
      approving.add(runId);
      try {
        return await approve(runId);
      } finally {
        approving.delete(runId);
      }
    });

    server.register('orch.discard', async ({ runId }) => {
      const current = deps.repository.get(runId);
      if (current === undefined) {
        return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Run not found.', retryable: false } };
      }
      if (busy(runId)) return conflict('This run is still being processed.', 'Cancel the run first, then discard it.');
      if (current.state === 'completed')
        return conflict(
          'This run is already merged.',
          'Nothing to discard: its worktrees were removed after the merge.',
        );
      const attempts = deps.repository.attempts(runId);
      await removeRunWorktrees(current, attempts);
      const discarded: OrchRun = { ...current, state: 'cancelled', stateReason: 'DISCARDED' };
      deps.repository.save(discarded, attempts);
      deps.processes.upsertOrchestration(discarded);
      publish({ type: 'run', run: discarded });
      return { ok: true, value: discarded };
    });
  }

  return {
    engine,
    register,
    plan,
    start,
    recoverInterrupted,
    get: (id: string) => deps.repository.get(id),
    list: (projectId?: string, limit?: number) => deps.repository.list(projectId, limit),
    attempts: (runId: string) => deps.repository.attempts(runId),
    stop: () => {
      for (const timer of eventTimers.values()) clearTimeout(timer);
      eventTimers.clear();
      pendingEvents.clear();
    },
  };
}
