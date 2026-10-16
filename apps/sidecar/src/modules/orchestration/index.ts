import { ErrorCode, type OrchRun, type OrchTaskSpec, type ProjectId, type Result } from '@itstudio/schemas';
import { MockAgentAdapter, type MockScript } from './adapters/mock-adapter.js';
import { OrchestrationEngine } from './engine.js';
import type { PlanValidationOptions } from './dag.js';
import type { OrchRepository } from './storage/orch-repository.js';
import type { RpcServer } from '../../rpc/rpc-server.js';
import type { ProcessRegistry } from '../../services/process-registry.js';

export interface OrchestrationModuleDependencies {
  readonly repository: OrchRepository;
  readonly processes: Pick<ProcessRegistry, 'upsertOrchestration'>;
  readonly validate: PlanValidationOptions;
  readonly createRun: (projectId: ProjectId, request: string, tasks: readonly OrchTaskSpec[]) => OrchRun;
  readonly scripts?: Partial<Record<'supervisor' | 'worker' | 'reviewer', MockScript>>;
  readonly publish?: (event: { readonly type: 'run'; readonly run: OrchRun }) => void;
}
export function createOrchestrationModule(deps: OrchestrationModuleDependencies) {
  const scripts = {
    ...deps.scripts,
    supervisor:
      deps.scripts?.supervisor ??
      (() =>
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
        })),
  };
  const engine = new OrchestrationEngine({ adapter: new MockAgentAdapter(scripts), validate: deps.validate });
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
    const plan = await engine.plan(
      await scripts.supervisor({ request }, { roleId: 'supervisor' } as Parameters<MockScript>[1]),
    );
    if (!plan.ok) return undefined;
    const run = deps.createRun(projectId, request, plan.value);
    deps.repository.save(run);
    deps.processes.upsertOrchestration(run);
    publish({ type: 'run', run });
    return run;
  }
  async function start(runId: string): Promise<OrchRun | undefined> {
    const current = deps.repository.get(runId);
    if (current === undefined) return undefined;
    const run = await engine.run(current, (updated, attempts) => {
      deps.repository.save(updated, attempts);
      deps.processes.upsertOrchestration(updated);
      publish({ type: 'run', run: updated });
    });
    deps.repository.save(run, engine.attempts(run.id));
    deps.processes.upsertOrchestration(run);
    publish({ type: 'run', run });
    return run;
  }
  function register(server: RpcServer): void {
    server.register('orch.plan', async ({ projectId, request }) => {
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
    const unavailable = (): Promise<Result<OrchRun>> =>
      Promise.resolve({
        ok: false,
        error: {
          code: ErrorCode.CONFLICT,
          message: 'This orchestration action is not available in ORCH-01.',
          retryable: false,
        },
      });
    server.register('orch.cancel', unavailable);
    server.register('orch.resume', unavailable);
    server.register('orch.approve', unavailable);
    server.register('orch.discard', unavailable);
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
