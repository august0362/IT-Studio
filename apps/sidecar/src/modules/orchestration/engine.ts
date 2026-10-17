import type { CoderOutput, MicroUsd, OrchAttempt, OrchRun, OrchTask, OrchTaskSpec, OrchUsage } from '@itstudio/schemas';
import type { IAgentExecutionAdapter } from '../../ports/agent-execution.js';
import { transitionRun } from './run-machine.js';
import { topologicalOrder, validatePlan, type PlanValidationOptions } from './dag.js';
import { blockFailedDependents, pickRunnable } from './scheduler.js';
import { isTargetForbidden, type IOrchWorkspace } from './workspace.js';
import type { Worktree } from './worktrees.js';

export interface OrchestrationEngineDependencies {
  readonly adapters: ReadonlyMap<string, IAgentExecutionAdapter>;
  readonly validate: PlanValidationOptions;
  readonly now?: () => string;
  readonly id?: () => string;
  readonly workspace?: IOrchWorkspace;
  readonly projectRoot?: string;
  readonly appExecutableDir?: string;
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
    readonly line?: number;
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
  ) {
    return false;
  }
  const obj = value as { verdict?: unknown; summary?: unknown; findings?: unknown };
  if (
    (obj.verdict !== 'pass' && obj.verdict !== 'fix_required' && obj.verdict !== 'reject') ||
    typeof obj.summary !== 'string' ||
    !Array.isArray(obj.findings)
  ) {
    return false;
  }
  return obj.findings.every((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const finding = item as {
      severity?: unknown;
      path?: unknown;
      message?: unknown;
      suggestedFix?: unknown;
      line?: unknown;
    };
    return (
      (finding.severity === 'info' ||
        finding.severity === 'warning' ||
        finding.severity === 'error' ||
        finding.severity === 'critical') &&
      typeof finding.path === 'string' &&
      typeof finding.message === 'string' &&
      typeof finding.suggestedFix === 'string' &&
      (finding.line === undefined || typeof finding.line === 'number')
    );
  });
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

  async probeAdapter(transport: string): Promise<Awaited<ReturnType<IAgentExecutionAdapter['probe']>>> {
    const cached = this.probeCache.get(transport);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return cached.status;
    }
    const selected = this.deps.adapters.get(transport);
    if (selected === undefined) {
      const result = { status: 'unavailable' as const, reason: `Adapter ${transport} not found.` };
      this.probeCache.set(transport, { status: result, expiresAt: Date.now() + 300_000 });
      return result;
    }
    const probed = await selected.probe();
    this.probeCache.set(transport, { status: probed, expiresAt: Date.now() + 300_000 });
    return probed;
  }

  async run(run: OrchRun, onChange?: (run: OrchRun, attempts: readonly OrchAttempt[]) => void): Promise<OrchRun> {
    if (!transitionRun(run.state, 'running').ok) return run;

    const projectRoot = this.deps.projectRoot ?? this.deps.validate.workspaceRoot;
    if (projectRoot && isTargetForbidden(projectRoot, process.cwd(), this.deps.appExecutableDir)) {
      return {
        ...run,
        state: 'failed',
        stateReason: 'TARGET_FORBIDDEN',
      };
    }

    let tasks: OrchTask[] = run.tasks.map((task) => ({
      ...task,
      state: task.state === 'draft' || task.state === 'ready' ? 'queued' : task.state,
    }));
    const attempts: OrchAttempt[] = [];
    const specs: OrchTaskSpec[] = tasks;
    const workers = run.agents.filter((agent) => agent.role === 'worker');
    const supervisor = run.agents.find((agent) => agent.role === 'supervisor');
    const reviewer = run.agents.find((agent) => agent.role === 'reviewer');
    let calls = run.agentCalls;
    const control: {
      pauseReason?: string;
      fatalFailureReason?: string;
    } = {};

    const taskWorktrees = new Map<string, Worktree>();
    const controller = new AbortController();
    this.controllers.set(run.id, controller);

    const isAborted = () => controller.signal.aborted;
    const isPaused = () => control.pauseReason !== undefined;
    const isFatal = () => control.fatalFailureReason !== undefined;
    const nextId = () => (this.deps.id ?? (() => `mock-${String(attempts.length + 1)}`))();
    const now = () => (this.deps.now ?? (() => new Date().toISOString()))();

    const calculateCost = (): number => {
      return attempts.reduce<number>((sum, a) => sum + (a.usage.costMicroUsd ?? 0), run.costMicroUsd);
    };

    const runStartedTime = new Date(now()).getTime();

    const checkBudget = ():
      | { readonly ok: true }
      | { readonly ok: false; readonly reason: 'BUDGET_CALLS' | 'BUDGET_TIME' | 'BUDGET_COST' } => {
      if (calls >= run.limits.maxAgentCalls) {
        return { ok: false, reason: 'BUDGET_CALLS' };
      }
      const current = new Date(now()).getTime();
      if (current - runStartedTime >= run.limits.maxWallClockMs) {
        return { ok: false, reason: 'BUDGET_TIME' };
      }
      const totalCost = calculateCost();
      if (totalCost >= run.limits.maxCostMicroUsd) {
        return { ok: false, reason: 'BUDGET_COST' };
      }
      return { ok: true };
    };

    if (run.costMicroUsd >= run.limits.maxCostMicroUsd) {
      this.controllers.delete(run.id);
      return {
        ...run,
        state: 'paused',
        stateReason: 'BUDGET_COST',
        tasks,
        agentCalls: calls,
      };
    }

    if (calls >= run.limits.maxAgentCalls) {
      this.controllers.delete(run.id);
      return {
        ...run,
        state: 'paused',
        stateReason: 'BUDGET_CALLS',
        tasks,
        agentCalls: calls,
      };
    }

    const invoke = async (
      task: OrchTask,
      agent: OrchRun['agents'][number],
      role: 'worker' | 'reviewer' | 'supervisor',
      input: unknown,
    ): Promise<{ ok: boolean; payload: unknown; usage: OrchUsage; attempt: OrchAttempt }> => {
      const budgetCheck = checkBudget();
      if (!budgetCheck.ok) {
        control.pauseReason = budgetCheck.reason;
        const dummyAttempt: OrchAttempt = {
          id: nextId() as OrchAttempt['id'],
          taskId: task.id,
          role,
          agent,
          state: 'failed',
          reason: budgetCheck.reason,
          changedFiles: [],
          evidence: [],
          usage: unknownUsage,
          startedAt: now() as OrchAttempt['startedAt'],
          endedAt: now() as OrchAttempt['startedAt'],
        };
        return { ok: false, payload: undefined, usage: unknownUsage, attempt: dummyAttempt };
      }

      // Reserve the call slot before any asynchronous worktree preparation so
      // concurrent pipelines cannot all pass the same maxAgentCalls check.
      calls += 1;

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
          calls -= 1;
          if (prepared.error.code === 'TARGET_FORBIDDEN') {
            control.fatalFailureReason = 'TARGET_FORBIDDEN';
          }
          return { ok: false, payload: undefined, usage: unknownUsage, attempt };
        }
        worktree = prepared.value;
        taskWorktrees.set(task.id, prepared.value);
      }

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

      const probed = await this.probeAdapter(agent.transport);
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
      if (safeResult.ok && worktree !== undefined && role === 'worker' && this.deps.workspace !== undefined) {
        applied = await this.deps.workspace.applyWorker(
          run,
          task,
          workerAttemptNo,
          worktree,
          safeResult.value.payload as CoderOutput,
          controller.signal,
        );
      }
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
      onChange?.(
        { ...run, state: 'running', tasks, agentCalls: calls, costMicroUsd: calculateCost() as MicroUsd },
        attempts,
      );
      return { ok: succeeded, payload, usage: succeeded ? safeResult.value.usage : unknownUsage, attempt };
    };

    const runTaskPipeline = async (
      task: OrchTask,
      worker: OrchRun['agents'][number],
      rev: OrchRun['agents'][number],
    ): Promise<void> => {
      let current: OrchTask = { ...task, state: 'assigned' };
      tasks = tasks.map((t) => (t.id === current.id ? current : t));
      onChange?.(
        { ...run, state: 'running', tasks, agentCalls: calls, costMicroUsd: calculateCost() as MicroUsd },
        attempts,
      );

      current = { ...current, state: 'running' };
      tasks = tasks.map((t) => (t.id === current.id ? current : t));
      onChange?.(
        { ...run, state: 'running', tasks, agentCalls: calls, costMicroUsd: calculateCost() as MicroUsd },
        attempts,
      );

      let passed = false;
      let fixCount = 0;
      let findings: Verdict['findings'] = [];

      while (!passed && calls < run.limits.maxAgentCalls && !isAborted() && !isPaused() && !isFatal()) {
        const work = await invoke(current, worker, 'worker', { task: current, findings });
        current = { ...current, attempts: [...current.attempts, work.attempt.id] };
        if (isAborted() || isPaused() || isFatal()) {
          break;
        }
        if (!work.ok) {
          current = { ...current, state: 'failed', stateReason: work.attempt.reason ?? 'WORKER_FAILED' };
          break;
        }

        current = { ...current, state: 'awaiting_handoff' as const };
        current = { ...current, state: 'in_review' as const };
        tasks = tasks.map((t) => (t.id === current.id ? current : t));
        onChange?.(
          { ...run, state: 'running', tasks, agentCalls: calls, costMicroUsd: calculateCost() as MicroUsd },
          attempts,
        );

        const tw = taskWorktrees.get(current.id);
        const reviewDiff =
          this.deps.workspace === undefined || tw === undefined ? undefined : await this.deps.workspace.diff(tw);
        const review = await invoke(current, rev, 'reviewer', {
          task: current,
          workerOutput: work.payload,
          previousFindings: findings,
          ...(reviewDiff?.ok ? { diff: reviewDiff.value } : {}),
        });
        current = { ...current, attempts: [...current.attempts, review.attempt.id] };
        if (isAborted() || isPaused() || isFatal()) {
          break;
        }

        const validVerdict = isVerdict(review.payload);
        if (!validVerdict) {
          const index = attempts.findIndex((item) => item.id === review.attempt.id);
          if (index >= 0) {
            const existingAttempt = attempts[index];
            if (existingAttempt !== undefined) {
              attempts[index] = { ...existingAttempt, state: 'failed', reason: 'REVIEW_INVALID' };
            }
          }
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
            if (supervisor !== undefined && workers.length > 1 && calls < run.limits.maxAgentCalls) {
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
            control.pauseReason = 'NEEDS_OWNER';
            break;
          } else {
            fixCount += 1;
            current = { ...current, state: 'queued' };
          }
        }
      }

      if (!passed && current.state === 'running' && !isAborted()) {
        current = { ...current, state: 'failed' };
      }
      tasks = tasks.map((t) => (t.id === current.id ? current : t));
      onChange?.(
        { ...run, state: 'running', tasks, agentCalls: calls, costMicroUsd: calculateCost() as MicroUsd },
        attempts,
      );
    };

    // Parallel worker pool
    const inFlight = new Map<string, Promise<void>>();
    const runningTaskIds = new Set<string>();

    while (!isAborted() && !isPaused() && !isFatal()) {
      tasks = [...blockFailedDependents(tasks)];

      const currentTotalCost = calculateCost();
      const slots = Math.max(0, run.limits.maxConcurrentWorkers - inFlight.size);

      let runnableIds: readonly string[] = [];
      if (slots > 0) {
        runnableIds = pickRunnable(
          tasks,
          specs,
          {
            maxConcurrentWorkers: run.limits.maxConcurrentWorkers,
            maxCostMicroUsd: run.limits.maxCostMicroUsd,
            maxAgentCalls: run.limits.maxAgentCalls,
          },
          { costMicroUsd: currentTotalCost, agentCalls: calls },
        ).filter((id) => !runningTaskIds.has(id));
      }

      let launched = false;
      for (const taskId of runnableIds) {
        if (inFlight.size >= run.limits.maxConcurrentWorkers) break;
        const task = tasks.find((t) => t.id === taskId);
        if (task === undefined) continue;

        const candidateWorkers = workers.filter(
          (agent) => task.candidateAgents.length === 0 || task.candidateAgents.includes(agent.agentId),
        );
        if (candidateWorkers.length === 0) {
          control.pauseReason = 'ADAPTER_UNAVAILABLE:worker';
          tasks = tasks.map((t) => (t.id === task.id ? { ...t, stateReason: 'ADAPTER_UNAVAILABLE:worker' } : t));
          break;
        }

        let candidateWorker: OrchRun['agents'][number] | undefined;
        for (const candidate of candidateWorkers) {
          const probe = await this.probeAdapter(candidate.transport);
          if (probe.status === 'available') {
            candidateWorker = candidate;
            break;
          }
        }
        if (candidateWorker === undefined) {
          const reason = `ADAPTER_UNAVAILABLE:${candidateWorkers[0]?.transport ?? 'worker'}`;
          control.pauseReason = reason;
          tasks = tasks.map((t) => (t.id === task.id ? { ...t, stateReason: reason } : t));
          break;
        }

        if (reviewer === undefined) {
          control.pauseReason = 'ADAPTER_UNAVAILABLE:reviewer';
          tasks = tasks.map((t) => (t.id === task.id ? { ...t, stateReason: 'ADAPTER_UNAVAILABLE:reviewer' } : t));
          break;
        }

        const reviewerProbe = await this.probeAdapter(reviewer.transport);
        if (reviewerProbe.status !== 'available') {
          control.pauseReason = `ADAPTER_UNAVAILABLE:${reviewer.transport}`;
          tasks = tasks.map((t) =>
            t.id === task.id ? { ...t, stateReason: `ADAPTER_UNAVAILABLE:${reviewer.transport}` } : t,
          );
          break;
        }

        runningTaskIds.add(taskId);
        launched = true;
        const promise = runTaskPipeline(task, candidateWorker, reviewer).finally(() => {
          inFlight.delete(taskId);
          runningTaskIds.delete(taskId);
        });
        inFlight.set(taskId, promise);
      }

      if (isPaused() || isFatal()) {
        break;
      }

      if (inFlight.size === 0 && !launched) {
        break;
      }

      if (inFlight.size > 0) {
        await Promise.race(Array.from(inFlight.values()));
      }
    }

    if (isAborted()) {
      tasks = tasks.map((t) =>
        ['running', 'assigned', 'queued', 'awaiting_handoff', 'in_review', 'fix_required'].includes(t.state)
          ? { ...t, state: 'cancelled' as const }
          : t,
      );
    }

    let allComplete = tasks.length > 0 && tasks.every((t) => t.state === 'completed');
    let integrationBranch: string | undefined;

    // Item D.1: Integration branch & Final review
    if (allComplete && !isAborted() && !isPaused() && !isFatal()) {
      if (this.deps.workspace !== undefined) {
        const prep = await this.deps.workspace.prepareIntegration(run);
        if (!prep.ok) {
          allComplete = false;
          control.fatalFailureReason = prep.error.code;
        } else {
          const integrationWorktree = prep.value;
          integrationBranch = integrationWorktree.branch;

          const orderedTasks = topologicalOrder(
            specs.filter((s) => tasks.some((t) => t.id === s.id && t.state === 'completed')),
          );
          let hasConflict = false;
          for (const s of orderedTasks) {
            const tw = taskWorktrees.get(s.id);
            if (tw === undefined) continue;
            const merged = await this.deps.workspace.mergeTask(run, integrationWorktree, tw);
            if (!merged.ok || merged.value.conflict) {
              if (reviewer !== undefined) {
                const conflictTask = tasks.find((t) => t.id === s.id) ?? tasks[0];
                if (conflictTask !== undefined) {
                  const conflictReview = await invoke(conflictTask, reviewer, 'reviewer', {
                    kind: 'integration-conflict',
                    diff: merged.ok ? merged.value.diff : '',
                  });
                  const valid = isVerdict(conflictReview.payload);
                  if (!valid || (conflictReview.payload as Verdict).verdict !== 'pass') {
                    hasConflict = true;
                    break;
                  }
                }
              } else {
                hasConflict = true;
                break;
              }
            }
          }

          if (hasConflict) {
            allComplete = false;
            control.pauseReason = 'INTEGRATION_CONFLICT';
          } else {
            const validationCommands = run.tasks.flatMap((t) => t.testCommands);
            const valResult = await this.deps.workspace.validateIntegration(
              run,
              integrationWorktree,
              validationCommands,
            );
            const evidence = valResult.ok ? valResult.value : [];

            if (!valResult.ok || evidence.some((item) => item.exitCode !== 0 || item.timedOut)) {
              allComplete = false;
              control.pauseReason = 'INTEGRATION_VALIDATION_FAILED';
            }

            let integrationDiff = '';
            const diffRes = await this.deps.workspace.diff(integrationWorktree);
            if (diffRes.ok) integrationDiff = diffRes.value;

            if (allComplete && supervisor !== undefined && tasks[0] !== undefined) {
              await invoke(tasks[0], supervisor, 'supervisor', {
                kind: 'final-review',
                integrationDiff,
                evidence,
              });
            }
          }
        }
      } else {
        if (supervisor !== undefined && tasks[0] !== undefined) {
          await invoke(tasks[0], supervisor, 'supervisor', {
            kind: 'final-review',
            integrationDiff: '',
            evidence: [],
          });
        }
      }
    }

    this.attemptsByRun.set(run.id, attempts);
    this.controllers.delete(run.id);

    const totalCost = calculateCost();
    const isCancelled = isAborted();
    const fatal = isFatal();
    const isAwaitingApproval = allComplete && !isCancelled && !fatal && !isPaused();

    const baseResult: OrchRun = {
      ...run,
      state: isCancelled ? 'cancelled' : fatal ? 'failed' : isAwaitingApproval ? 'awaiting_approval' : 'paused',
      tasks,
      agentCalls: calls,
      costMicroUsd: totalCost as MicroUsd,
    };

    if (isCancelled) {
      return { ...baseResult, stateReason: 'CANCELLED' };
    }
    if (fatal && control.fatalFailureReason !== undefined) {
      return { ...baseResult, stateReason: control.fatalFailureReason };
    }
    if (isAwaitingApproval) {
      const copy: OrchRun = { ...baseResult };
      Reflect.deleteProperty(copy, 'stateReason');
      if (integrationBranch !== undefined) {
        return { ...copy, integrationBranch };
      }
      return copy;
    }
    return {
      ...baseResult,
      stateReason: control.pauseReason ?? 'TASK_FAILURE',
      ...(integrationBranch !== undefined ? { integrationBranch } : {}),
    };
  }
}

export type { OrchTaskSpec };
