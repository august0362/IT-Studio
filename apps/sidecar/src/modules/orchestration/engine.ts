import type { CoderOutput, OrchAttempt, OrchRun, OrchTask, OrchTaskSpec, OrchUsage } from '@itstudio/schemas';
import type { IAgentExecutionAdapter } from '../../ports/agent-execution.js';
import { transitionRun } from './run-machine.js';
import { validatePlan, type PlanValidationOptions } from './dag.js';
import { blockFailedDependents, pickRunnable } from './scheduler.js';
import type { IOrchWorkspace } from './workspace.js';
import type { Worktree } from './worktrees.js';

export interface OrchestrationEngineDependencies {
  readonly adapters: ReadonlyMap<string, IAgentExecutionAdapter>;
  readonly validate: PlanValidationOptions;
  readonly now?: () => string;
  readonly id?: () => string;
  readonly workspace?: IOrchWorkspace;
}
const unknownUsage: OrchUsage = {
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  reasoningTokens: null,
  source: 'unknown',
  costMicroUsd: null,
  billing: 'unknown',
};
interface Verdict {
  readonly verdict: 'pass' | 'fix_required' | 'reject';
  readonly findings: readonly {
    readonly severity: 'info' | 'warning' | 'error' | 'critical';
    readonly path: string;
    readonly message: string;
    readonly suggestedFix: string;
  }[];
  readonly summary: string;
}
function isVerdict(value: unknown): value is Verdict {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('verdict' in value) ||
    !('findings' in value) ||
    !('summary' in value)
  )
    return false;
  if (
    (value.verdict !== 'pass' && value.verdict !== 'fix_required' && value.verdict !== 'reject') ||
    typeof value.summary !== 'string' ||
    !Array.isArray(value.findings)
  )
    return false;
  return value.findings.every(
    (finding) =>
      typeof finding === 'object' &&
      finding !== null &&
      'severity' in finding &&
      (finding.severity === 'info' ||
        finding.severity === 'warning' ||
        finding.severity === 'error' ||
        finding.severity === 'critical') &&
      'path' in finding &&
      typeof finding.path === 'string' &&
      'message' in finding &&
      typeof finding.message === 'string' &&
      'suggestedFix' in finding &&
      typeof finding.suggestedFix === 'string' &&
      (!('line' in finding) || typeof finding.line === 'number'),
  );
}
export class OrchestrationEngine {
  private readonly deps: OrchestrationEngineDependencies;
  private readonly attemptsByRun = new Map<string, readonly OrchAttempt[]>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly probeCache = new Map<
    string,
    { readonly expiresAt: number; readonly status: Awaited<ReturnType<IAgentExecutionAdapter['probe']>> }
  >();
  constructor(deps: OrchestrationEngineDependencies) {
    this.deps = deps;
  }
  plan(input: unknown): Promise<ReturnType<typeof validatePlan>> {
    return Promise.resolve(validatePlan(input, this.deps.validate));
  }
  attempts(runId: string): readonly OrchAttempt[] {
    return this.attemptsByRun.get(runId) ?? [];
  }
  cancel(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (controller === undefined) return false;
    controller.abort();
    return true;
  }
  async run(run: OrchRun, onChange?: (run: OrchRun, attempts: readonly OrchAttempt[]) => void): Promise<OrchRun> {
    if (!transitionRun(run.state, 'running').ok) return run;
    let tasks: OrchTask[] = run.tasks.map((task) => ({ ...task, state: 'queued' }));
    const attempts: OrchAttempt[] = [];
    const specs: OrchTaskSpec[] = tasks;
    const workers = run.agents.filter((agent) => agent.role === 'worker');
    const supervisor = run.agents.find((agent) => agent.role === 'supervisor');
    const reviewer = run.agents.find((agent) => agent.role === 'reviewer');
    let calls = run.agentCalls;
    let exhausted = false;
    let workerWorktree: Worktree | undefined;
    const controller = new AbortController();
    this.controllers.set(run.id, controller);
    const nextId = () => (this.deps.id ?? (() => `mock-${String(attempts.length + 1)}`))();
    const now = () => (this.deps.now ?? (() => new Date().toISOString()))();
    const invoke = async (
      task: OrchTask,
      agent: OrchRun['agents'][number],
      role: 'worker' | 'reviewer' | 'supervisor',
      input: unknown,
    ): Promise<{ ok: boolean; payload: unknown; usage: OrchUsage; attempt: OrchAttempt }> => {
      const id = nextId();
      const startedAt = now();
      const workerAttemptNo =
        role === 'worker' ? attempts.filter((item) => item.taskId === task.id && item.role === 'worker').length + 1 : 0;
      let worktree: Worktree | undefined;
      if (role === 'worker' && this.deps.workspace !== undefined) {
        const prepared = await this.deps.workspace.prepareAttempt(run, task, workerAttemptNo);
        if (!prepared.ok) {
          const attempt: OrchAttempt = {
            id: id as OrchAttempt['id'],
            taskId: task.id,
            role,
            agent,
            state: 'failed',
            reason: prepared.error.code,
            changedFiles: [],
            evidence: [],
            usage: unknownUsage,
            startedAt: startedAt as OrchAttempt['startedAt'],
            endedAt: now() as OrchAttempt['startedAt'],
          };
          attempts.push(attempt);
          return { ok: false, payload: undefined, usage: unknownUsage, attempt };
        }
        worktree = prepared.value;
        workerWorktree = prepared.value;
      }
      calls += 1;
      const envelope = {
        schemaVersion: '1',
        agentId: agent.agentId,
        roleId: role,
        roleVersion: '1',
        modelId: agent.modelId ?? 'mock',
        providerId: agent.providerId ?? 'mock',
        transportId: agent.transport,
        projectId: run.projectId,
        orchestrationRunId: run.id,
        taskId: task.id,
        attemptId: id,
        assignedWorktree: worktree?.path ?? null,
        allowedPaths: task.allowedPaths,
        approvedTools: [],
        forbiddenActions: worktree === undefined ? ['write-to-disk'] : [],
        objective: task.objective,
        requirements: [],
        acceptanceCriteria: task.acceptanceCriteria,
        reportingSchema: {},
        budgetPolicy: run.limits,
        timeoutMs: task.timeoutMs,
        contextReferences: [],
      };
      const selected = this.deps.adapters.get(agent.transport);
      if (selected === undefined) {
        const attempt: OrchAttempt = {
          id: id as OrchAttempt['id'],
          taskId: task.id,
          role,
          agent,
          state: 'failed',
          reason: `ADAPTER_UNAVAILABLE:${agent.transport}`,
          changedFiles: [],
          evidence: [],
          usage: unknownUsage,
          startedAt: startedAt as OrchAttempt['startedAt'],
          endedAt: now() as OrchAttempt['startedAt'],
        };
        attempts.push(attempt);
        return { ok: false, payload: undefined, usage: unknownUsage, attempt };
      }
      const cached = this.probeCache.get(agent.transport);
      const probed = cached !== undefined && cached.expiresAt > Date.now() ? cached.status : await selected.probe();
      if (cached === undefined || cached.expiresAt <= Date.now())
        this.probeCache.set(agent.transport, { status: probed, expiresAt: Date.now() + 300_000 });
      if (probed.status !== 'available') {
        const attempt: OrchAttempt = {
          id: id as OrchAttempt['id'],
          taskId: task.id,
          role,
          agent,
          state: 'failed',
          reason: `ADAPTER_UNAVAILABLE:${agent.transport}`,
          changedFiles: [],
          evidence: [],
          usage: unknownUsage,
          startedAt: startedAt as OrchAttempt['startedAt'],
          endedAt: now() as OrchAttempt['startedAt'],
        };
        attempts.push(attempt);
        return { ok: false, payload: undefined, usage: unknownUsage, attempt };
      }
      const result = await selected.run(envelope, input, controller.signal, () => undefined);
      const expectedAck = {
        ack: true,
        roleId: envelope.roleId,
        taskId: envelope.taskId,
        attemptId: envelope.attemptId,
        allowedPaths: envelope.allowedPaths,
      };
      const ackMatches = result.ok && JSON.stringify(result.value.ack) === JSON.stringify(expectedAck);
      const safeResult =
        result.ok && !ackMatches
          ? {
              ok: false as const,
              error: {
                code: 'ROLE_ACK_MISMATCH' as const,
                message: 'Agent acknowledgement did not match its assignment.',
                retryable: false,
              },
            }
          : result;
      let applied: Awaited<ReturnType<IOrchWorkspace['applyWorker']>> | undefined;
      if (safeResult.ok && worktree !== undefined && role === 'worker' && this.deps.workspace !== undefined)
        applied = await this.deps.workspace.applyWorker(
          run,
          task,
          workerAttemptNo,
          worktree,
          safeResult.value.payload as CoderOutput,
          controller.signal,
        );
      const succeeded = safeResult.ok && (applied === undefined || applied.ok);
      const payload = succeeded ? safeResult.value.payload : undefined;
      const attempt: OrchAttempt = {
        id: id as OrchAttempt['id'],
        taskId: task.id,
        role,
        agent,
        state: controller.signal.aborted ? 'cancelled' : succeeded ? 'succeeded' : 'failed',
        ...(succeeded
          ? {}
          : {
              reason:
                applied !== undefined && !applied.ok
                  ? applied.error.code
                  : safeResult.ok
                    ? 'WORKER_FAILED'
                    : safeResult.error.code,
            }),
        ...(applied?.ok
          ? {
              changedFiles: applied.value.changedFiles,
              baseSha: applied.value.baseSha,
              headSha: applied.value.headSha,
              evidence: applied.value.evidence,
            }
          : { changedFiles: [], evidence: [] }),
        ...(worktree === undefined ? {} : { worktree: worktree.path }),
        usage: safeResult.ok ? safeResult.value.usage : unknownUsage,
        startedAt: startedAt as OrchAttempt['startedAt'],
        endedAt: now() as OrchAttempt['startedAt'],
      };
      attempts.push(attempt);
      onChange?.({ ...run, state: 'running', tasks, agentCalls: calls }, attempts);
      return { ok: succeeded, payload, usage: succeeded ? safeResult.value.usage : unknownUsage, attempt };
    };
    for (let schedulerStep = 0; schedulerStep < tasks.length + run.limits.maxAgentCalls; schedulerStep += 1) {
      if (controller.signal.aborted) break;
      tasks = [...blockFailedDependents(tasks)];
      const runnable = pickRunnable(
        tasks,
        specs,
        {
          maxConcurrentWorkers: run.limits.maxConcurrentWorkers,
          maxCostMicroUsd: run.limits.maxCostMicroUsd,
          maxAgentCalls: run.limits.maxAgentCalls,
        },
        { costMicroUsd: run.costMicroUsd, agentCalls: calls },
      );
      if (runnable.length === 0) break;
      const taskId = runnable[0];
      if (taskId === undefined) break;
      const task = tasks.find((item) => item.id === taskId);
      if (task === undefined) break;
      const worker = workers.find((agent) => agent.agentId === task.assignedAgentId) ?? workers[0];
      if (worker === undefined || reviewer === undefined) {
        exhausted = true;
        break;
      }
      let current: OrchTask = { ...task, state: 'assigned' };
      current = { ...current, state: 'running' };
      let passed = false;
      let fixCount = 0;
      let findings: Verdict['findings'] = [];
      while (!passed && calls < run.limits.maxAgentCalls) {
        const work = await invoke(current, worker, 'worker', { task: current, findings });
        current = { ...current, attempts: [...current.attempts, work.attempt.id] };
        if (!work.ok) {
          current = { ...current, state: 'failed', stateReason: 'WORKER_FAILED' };
          break;
        }
        current = { ...current, state: 'awaiting_handoff' };
        current = { ...current, state: 'in_review' };
        const reviewDiff =
          this.deps.workspace === undefined || workerWorktree === undefined
            ? undefined
            : await this.deps.workspace.diff(workerWorktree);
        const review = await invoke(current, reviewer, 'reviewer', {
          task: current,
          workerOutput: work.payload,
          previousFindings: findings,
          ...(reviewDiff?.ok ? { diff: reviewDiff.value } : {}),
        });
        current = { ...current, attempts: [...current.attempts, review.attempt.id] };
        const validVerdict = isVerdict(review.payload);
        if (!validVerdict) {
          const index = attempts.findIndex((item) => item.id === review.attempt.id);
          if (index >= 0) attempts[index] = { ...review.attempt, state: 'failed', reason: 'REVIEW_INVALID' };
        }
        const verdict: Verdict = validVerdict
          ? (review.payload as Verdict)
          : {
              verdict: 'fix_required' as const,
              findings: [
                {
                  severity: 'error' as const,
                  path: '',
                  message: 'Reviewer returned an invalid verdict',
                  suggestedFix: 'Return a valid reviewer verdict.',
                },
              ],
              summary: 'Invalid reviewer verdict.',
            };
        if (verdict.verdict === 'pass') {
          passed = true;
          const complete = { ...current, state: 'completed' as const };
          Reflect.deleteProperty(complete, 'stateReason');
          current = complete;
        } else if (verdict.verdict === 'reject') {
          current = { ...current, state: 'failed', stateReason: 'REVIEW_REJECTED' };
          break;
        } else {
          findings = verdict.findings;
          current = { ...current, state: 'fix_required', fixRounds: current.fixRounds + 1 };
          if (fixCount >= run.limits.maxFixRounds) {
            if (!exhausted && supervisor !== undefined && workers.length > 1 && calls < run.limits.maxAgentCalls) {
              exhausted = true;
              const reassignedAgent = workers.find((agent) => agent.agentId !== worker.agentId);
              await invoke(current, supervisor, 'supervisor', {
                decision: 'reassign',
                reassignToAgentId: reassignedAgent?.agentId,
                task: current,
                findings,
              });
              if (reassignedAgent !== undefined) current = { ...current, assignedAgentId: reassignedAgent.agentId };
            }
            current = { ...current, state: 'fix_required', stateReason: 'NEEDS_OWNER' };
            break;
          } else {
            fixCount += 1;
            current = { ...current, state: 'queued' };
          }
        }
      }
      if (!passed && current.state === 'running') current = { ...current, state: 'failed' };
      tasks = tasks.map((item) => (item.id === current.id ? current : item));
      onChange?.({ ...run, state: 'running', tasks, agentCalls: calls }, attempts);
      if (current.state === 'fix_required' && current.stateReason === 'NEEDS_OWNER') {
        exhausted = true;
        break;
      }
    }
    const allComplete = tasks.every((task) => task.state === 'completed');
    this.attemptsByRun.set(run.id, attempts);
    const paused = !allComplete;
    this.controllers.delete(run.id);
    return {
      ...run,
      state: controller.signal.aborted ? 'cancelled' : allComplete ? 'awaiting_approval' : 'paused',
      ...(controller.signal.aborted
        ? { stateReason: 'CANCELLED' }
        : paused
          ? { stateReason: exhausted ? 'NEEDS_OWNER' : 'TASK_FAILURE' }
          : {}),
      tasks,
      agentCalls: calls,
      costMicroUsd: run.costMicroUsd,
    };
  }
}
export type { OrchTaskSpec };
