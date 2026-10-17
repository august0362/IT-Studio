import { ErrorCode, type OrchRun, type OrchTaskSpec, type ProjectId } from '@itstudio/schemas';
import { MockAgentAdapter, type MockScript } from './adapters/mock-adapter.js';
import { OrchestrationEngine } from './engine.js';
import type { PlanValidationOptions } from './dag.js';
import type { OrchRepository } from './storage/orch-repository.js';
import type { RpcServer } from '../../rpc/rpc-server.js';
import type { ProcessRegistry } from '../../services/process-registry.js';
import type { IAgentExecutionAdapter } from '../../ports/agent-execution.js';
import type { IOrchWorkspace } from './workspace.js';
import { isTargetForbidden } from './workspace.js';
import type { IProcessRunner } from '../../ports/process-runner.js';
import type { IProjectLifecycleRepository } from '../../ports/project-repository.js';

export interface OrchestrationModuleDependencies {
  readonly repository: OrchRepository;
  readonly processes: Pick<ProcessRegistry, 'upsertOrchestration'>;
  readonly validate: PlanValidationOptions;
  readonly createRun: (projectId: ProjectId, request: string, tasks: readonly OrchTaskSpec[]) => OrchRun;
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

export function createOrchestrationModule(deps: OrchestrationModuleDependencies) {
  const scripts = {
    worker: () => Promise.resolve({ operations: [], summary: 'Done', assumptions: [] }),
    reviewer: () => Promise.resolve({ verdict: 'pass', findings: [], summary: 'Pass' }),
    supervisor: () =>
      Promise.resolve({
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
      }),
    ...deps.scripts,
  };
  const mockAdapter = new MockAgentAdapter(scripts);
  const adapterList = [...(deps.includeMock === true ? [mockAdapter] : []), ...(deps.adapters ?? [])];
  const adapterMap = new Map(adapterList.map((adapter) => [adapter.id, adapter]));
  const engine = new OrchestrationEngine({
    adapters: adapterMap,
    validate: deps.validate,
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

  async function start(runId?: string): Promise<OrchRun | undefined> {
    if (runId === undefined) {
      const runs = deps.repository.list();
      for (const run of runs) {
        if (run.state === 'running') {
          const interruptedRun: OrchRun = {
            ...run,
            state: 'paused_interrupted',
            stateReason: 'INTERRUPTED',
          };
          const attempts = deps.repository
            .attempts(run.id)
            .map((attempt) =>
              attempt.state === 'running' ? { ...attempt, state: 'unknown' as const, reason: 'INTERRUPTED' } : attempt,
            );
          deps.repository.save(interruptedRun, attempts);
          deps.processes.upsertOrchestration(interruptedRun);
          publish({ type: 'run', run: interruptedRun });
        }
      }
      return undefined;
    }
    const current = deps.repository.get(runId);
    if (current === undefined) return undefined;
    const running = engine.run(current, (updated, attempts) => {
      deps.repository.save(updated, attempts);
      deps.processes.upsertOrchestration(updated);
      publish({ type: 'run', run: updated });
    });
    activeRuns.set(runId, running);
    const run = await running;
    activeRuns.delete(runId);
    deps.repository.save(run, engine.attempts(run.id));
    deps.processes.upsertOrchestration(run);
    publish({ type: 'run', run });
    return run;
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

    server.register('orch.start', async ({ runId }) => {
      const run = await start(runId);
      return run === undefined
        ? { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Run not found.', retryable: false } }
        : { ok: true, value: run };
    });

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
      if (current.state !== 'paused' && current.state !== 'paused_interrupted') {
        return {
          ok: false,
          error: { code: ErrorCode.CONFLICT, message: 'Run is not paused.', retryable: false },
        };
      }
      const resumed: OrchRun = { ...current };
      Reflect.deleteProperty(resumed, 'stateReason');
      deps.repository.save(resumed, deps.repository.attempts(runId));
      const completed = await start(runId);
      return completed === undefined
        ? { ok: false, error: { code: ErrorCode.INTERNAL, message: 'Resume failed to complete.', retryable: false } }
        : { ok: true, value: completed };
    });

    server.register('orch.approve', async ({ runId }) => {
      const current = deps.repository.get(runId);
      if (current === undefined) {
        return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Run not found.', retryable: false } };
      }
      if (current.state !== 'awaiting_approval') {
        return {
          ok: false,
          error: { code: ErrorCode.CONFLICT, message: 'Run is not awaiting approval.', retryable: false },
        };
      }
      const project = deps.projects !== undefined ? await deps.projects.get(current.projectId) : null;
      const workspaceRoot = project?.workspaceRoot ?? deps.validate.workspaceRoot;
      const attempts = deps.repository.attempts(runId);
      const touchedFiles = Array.from(new Set(attempts.flatMap((a) => a.changedFiles)));

      if (deps.runner !== undefined) {
        const statusArgs = ['status', '--porcelain'];
        if (touchedFiles.length > 0) {
          statusArgs.push('--', ...touchedFiles);
        }
        const status = await deps.runner.run({
          executable: 'git',
          args: statusArgs,
          cwd: workspaceRoot,
          env: process.env,
          timeoutMs: 30_000,
        });
        if (!status.ok || status.value.exitCode !== 0 || status.value.stdoutTail.trim() !== '') {
          return {
            ok: false,
            error: {
              code: ErrorCode.CONFLICT,
              message: 'Working tree has uncommitted changes in touched files.',
              retryable: false,
            },
          };
        }
        const integrationBranch = current.integrationBranch ?? `itstudio/orch/${current.id}/integration`;
        const merge = await deps.runner.run({
          executable: 'git',
          args: ['merge', '--no-ff', integrationBranch],
          cwd: workspaceRoot,
          env: process.env,
          timeoutMs: 30_000,
        });
        if (!merge.ok || merge.value.exitCode !== 0) {
          return {
            ok: false,
            error: {
              code: ErrorCode.CONFLICT,
              message: 'Failed to merge integration branch into target branch.',
              retryable: false,
            },
          };
        }
      }

      const completed: OrchRun = { ...current, state: 'completed' };
      deps.repository.save(completed, attempts);
      deps.processes.upsertOrchestration(completed);
      publish({ type: 'run', run: completed });
      return { ok: true, value: completed };
    });

    server.register('orch.discard', async ({ runId }) => {
      const current = deps.repository.get(runId);
      if (current === undefined) {
        return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Run not found.', retryable: false } };
      }
      const attempts = deps.repository.attempts(runId);
      if (deps.workspace !== undefined) {
        for (const att of attempts) {
          if (att.worktree) {
            await deps.workspace.cleanup(current, {
              path: att.worktree,
              branch: `itstudio/orch/${current.id}/${att.taskId ?? 'task'}-${String(att.id)}`,
              baseSha: att.baseSha ?? '',
            });
          }
        }
        if (current.integrationBranch) {
          const project = deps.projects !== undefined ? await deps.projects.get(current.projectId) : null;
          const workspaceRoot = project?.workspaceRoot ?? deps.validate.workspaceRoot;
          await deps.workspace.cleanup(current, {
            path: `${workspaceRoot}/.itstudio/orch/${current.id}/integration`,
            branch: current.integrationBranch,
            baseSha: '',
          });
        }
      }
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
