import { randomUUID } from 'node:crypto';
import {
  ErrorCode,
  type AppError,
  type CoderOutput,
  type CommandRun,
  type CommandSpec,
  type FindingSeverity,
  type MicroUsd,
  type OrchAgentRef,
  type OrchAttempt,
  type OrchRun,
  type OrchTask,
  type OrchTaskSpec,
  type OrchUsage,
  type Result,
} from '@itstudio/schemas';
import type { AgentEnvelope, IAgentExecutionAdapter } from '../../kernel/ports/agent-execution.js';
import { transitionRun } from './run-machine.js';
import { topologicalOrder, validatePlan, type PlanValidationOptions } from './dag.js';
import { conflictResolutionSchema, finalReviewSchema, type FinalReview } from './prompts.js';
import { requeueUnfinished, taskResume, type TaskResume } from './recovery.js';
import { blockFailedDependents, pickRunnable } from './scheduler.js';
import { isTargetForbidden, type ConflictResolution, type IOrchWorkspace, type MergeConflict } from './workspace.js';
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

const SEVERITY: Readonly<Record<Verdict['findings'][number]['severity'], FindingSeverity>> = {
  critical: 'blocker',
  error: 'major',
  warning: 'minor',
  info: 'nit',
};

/** Maps the reviewer protocol verdict onto the stored `OrchAttempt.verdict` contract. */
function storedVerdict(verdict: Verdict): NonNullable<OrchAttempt['verdict']> {
  return {
    verdict: verdict.verdict,
    summary: verdict.summary,
    findings: verdict.findings.map((finding) => ({
      severity: SEVERITY[finding.severity],
      path: finding.path,
      ...(finding.line === undefined ? {} : { line: finding.line }),
      message: finding.message,
      suggestedFix: finding.suggestedFix,
    })),
  };
}

/** Stores the supervisor's final review in the attempt verdict shape the UI already shows. */
function storedFinalReview(review: FinalReview): NonNullable<OrchAttempt['verdict']> {
  return {
    verdict: review.approveForOwner ? 'pass' : 'reject',
    summary: review.summary,
    findings: review.risks.map((message) => ({ severity: 'minor' as const, path: '', message, suggestedFix: '' })),
  };
}

/** Every task may list the same project command; integration runs each distinct command once. */
function distinctCommands(commands: readonly CommandSpec[]): readonly CommandSpec[] {
  const seen = new Set<string>();
  return commands.filter((command) => {
    const key = JSON.stringify([command.executable, command.args]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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

  /**
   * Asks a real supervisor agent for a plan and validates it. The attempt is returned so the caller can
   * store it with the run as evidence of the planning call.
   */
  async supervisePlan(
    agent: OrchAgentRef,
    context: {
      readonly projectId: string;
      readonly runId: string;
      readonly input: unknown;
      readonly timeoutMs: number;
      readonly validate?: PlanValidationOptions;
    },
  ): Promise<{ readonly plan: Result<readonly OrchTaskSpec[]>; readonly attempt: OrchAttempt }> {
    const id = (this.deps.id ?? (() => randomUUID()))();
    const startedAt = (this.deps.now ?? (() => new Date().toISOString()))();
    const finish = (state: OrchAttempt['state'], usage: OrchUsage, reason?: string): OrchAttempt => ({
      id: id as OrchAttempt['id'],
      taskId: null,
      role: 'supervisor',
      agent,
      state,
      ...(reason === undefined ? {} : { reason }),
      changedFiles: [],
      evidence: [],
      usage,
      startedAt: startedAt as OrchAttempt['startedAt'],
      endedAt: (this.deps.now ?? (() => new Date().toISOString()))() as OrchAttempt['startedAt'],
    });
    const failed = (code: AppError['code'], message: string, usage: OrchUsage = unknownUsage) => ({
      plan: { ok: false as const, error: { code, message, retryable: false } },
      attempt: finish('failed', usage, code),
    });
    const adapter = this.deps.adapters.get(agent.transport);
    const probed = await this.probeAdapter(agent.transport);
    if (adapter === undefined || probed.status !== 'available')
      return failed(
        ErrorCode.VALIDATION,
        `Supervisor agent ${agent.transport} is ${probed.status}${probed.reason === undefined ? '' : `: ${probed.reason}`}`,
      );
    const envelope: AgentEnvelope = {
      schemaVersion: '1',
      agentId: agent.agentId,
      roleId: 'supervisor',
      roleVersion: '1',
      modelId: agent.modelId ?? 'mock',
      providerId: agent.providerId ?? 'mock',
      transportId: agent.transport,
      projectId: context.projectId,
      orchestrationRunId: context.runId,
      taskId: null,
      attemptId: id,
      assignedWorktree: null,
      allowedPaths: [],
      approvedTools: [],
      forbiddenActions: ['write-to-disk'],
      objective: 'Plan the owner request as a DAG of worker tasks.',
      requirements: [],
      acceptanceCriteria: [],
      reportingSchema: {},
      budgetPolicy: {},
      timeoutMs: context.timeoutMs,
      contextReferences: [],
    };
    const controller = new AbortController();
    const result = await adapter.run(envelope, context.input, controller.signal, () => undefined);
    if (!result.ok) return failed(result.error.code, result.error.message);
    const plan = validatePlan(result.value.payload, context.validate ?? this.deps.validate);
    return plan.ok
      ? { plan, attempt: finish('succeeded', result.value.usage) }
      : { plan, attempt: finish('failed', result.value.usage, ErrorCode.PLAN_INVALID) };
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

  /**
   * Runs (or resumes) a run. `history` holds the attempts persisted by earlier engine sessions of this run:
   * completed tasks keep their result and worktree, unfinished tasks continue with new attempt ids.
   */
  async run(
    run: OrchRun,
    onChange?: (run: OrchRun, attempts: readonly OrchAttempt[]) => void,
    history: readonly OrchAttempt[] = [],
  ): Promise<OrchRun> {
    if (!transitionRun(run.state, 'running').ok) return run;

    // With a workspace the real project root is checked per attempt (prepareAttempt / prepareIntegration);
    // `validate.workspaceRoot` is then only the plan-validation root, not the target project.
    const projectRoot =
      this.deps.projectRoot ?? (this.deps.workspace === undefined ? this.deps.validate.workspaceRoot : undefined);
    if (projectRoot && isTargetForbidden(projectRoot, process.cwd(), this.deps.appExecutableDir)) {
      return {
        ...run,
        state: 'failed',
        stateReason: 'TARGET_FORBIDDEN',
      };
    }

    // Every session rebuilds integration and decides its own outcome: earlier integration results and the
    // reason of an earlier pause do not carry over.
    const base: OrchRun = { ...run };
    for (const key of ['stateReason', 'integrationBranch', 'integrationBaseSha', 'integrationHeadSha'] as const)
      Reflect.deleteProperty(base, key);
    const extras: {
      baseSha?: string;
      integrationBranch?: string;
      integrationBaseSha?: string;
      integrationHeadSha?: string;
    } = {};
    const resumes = new Map<string, TaskResume>(
      run.tasks.map((task) => [task.id, taskResume(run.id, task.id, history)]),
    );
    let tasks: OrchTask[] = requeueUnfinished(run.tasks).map((task) => {
      if (task.state === 'completed' || resumes.get(task.id)?.reviewPassed !== true) return task;
      // The review already passed; only the task state was not saved before the engine stopped.
      return { ...task, state: 'completed' as const };
    });
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
    for (const [taskId, resume] of resumes)
      if (resume.worktree !== undefined) taskWorktrees.set(taskId, resume.worktree);
    const controller = new AbortController();
    this.controllers.set(run.id, controller);

    const isAborted = () => controller.signal.aborted;
    const isPaused = () => control.pauseReason !== undefined;
    const isFatal = () => control.fatalFailureReason !== undefined;
    const stopped = () => isAborted() || isPaused() || isFatal();
    const nextId = () => (this.deps.id ?? (() => `mock-${String(attempts.length + 1)}`))();
    const now = () => (this.deps.now ?? (() => new Date().toISOString()))();

    const calculateCost = (): number => {
      return attempts.reduce<number>((sum, a) => sum + (a.usage.costMicroUsd ?? 0), run.costMicroUsd);
    };
    const snapshot = (): OrchRun => ({
      ...base,
      ...extras,
      state: 'running',
      tasks,
      agentCalls: calls,
      costMicroUsd: calculateCost() as MicroUsd,
    });
    const persist = (): void => onChange?.(snapshot(), attempts);
    const record = (attempt: OrchAttempt): OrchAttempt => {
      const index = attempts.findIndex((item) => item.id === attempt.id);
      if (index < 0) attempts.push(attempt);
      else attempts[index] = attempt;
      persist();
      return attempt;
    };
    const update = (id: string, patch: Partial<OrchAttempt>): void => {
      const existing = attempts.find((item) => item.id === id);
      if (existing !== undefined) record({ ...existing, ...patch });
    };
    const workerAttempts = (taskId: string): number =>
      (resumes.get(taskId)?.workerAttempts ?? 0) +
      attempts.filter((item) => item.taskId === taskId && item.role === 'worker').length;

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
        ...base,
        state: 'paused',
        stateReason: 'BUDGET_COST',
        tasks,
        agentCalls: calls,
      };
    }

    if (calls >= run.limits.maxAgentCalls) {
      this.controllers.delete(run.id);
      return {
        ...base,
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
      readOnly?: Worktree,
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
      const workerAttemptNo = role === 'worker' ? workerAttempts(task.id) + 1 : 0;
      const started: OrchAttempt = {
        id: id as OrchAttempt['id'],
        taskId: task.id,
        role,
        agent,
        state: 'running',
        changedFiles: [],
        evidence: [],
        usage: unknownUsage,
        startedAt: startedAt as OrchAttempt['startedAt'],
      };
      // Saved before a worktree exists or money is spent: after a crash the restart sweep marks it UNKNOWN,
      // its number (and worktree name) is never reused and its worktree is still found for cleanup.
      record(started);
      const failedAttempt = (reason: string): OrchAttempt =>
        record({ ...started, state: 'failed', reason, endedAt: now() as OrchAttempt['startedAt'] });
      let worktree: Worktree | undefined;
      if (role === 'worker' && this.deps.workspace !== undefined) {
        const prepared = await this.deps.workspace.prepareAttempt(snapshot(), task, workerAttemptNo);
        if (!prepared.ok) {
          calls -= 1;
          if (prepared.error.code === 'TARGET_FORBIDDEN') {
            control.fatalFailureReason = 'TARGET_FORBIDDEN';
          }
          const attempt = failedAttempt(prepared.error.code);
          return { ok: false, payload: undefined, usage: unknownUsage, attempt };
        }
        worktree = prepared.value;
        taskWorktrees.set(task.id, prepared.value);
        if (base.baseSha === undefined && extras.baseSha === undefined) extras.baseSha = prepared.value.baseSha;
        record({ ...started, worktree: prepared.value.path });
      }
      let agentInput = input;
      if (worktree !== undefined && this.deps.workspace?.workerContext !== undefined) {
        const context = await this.deps.workspace.workerContext(worktree, task.allowedPaths);
        if (context.ok && typeof input === 'object' && input !== null)
          agentInput = { ...input, tree: context.value.tree, files: context.value.files };
      }
      // Reviewers read the task's worktree (CLI agents run there read-only); they never get write access.
      const readOnlyWorktree = role === 'reviewer' ? (readOnly ?? taskWorktrees.get(task.id)) : undefined;

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
        assignedWorktree: worktree?.path ?? readOnlyWorktree?.path ?? null,
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
        const attempt = failedAttempt(`ADAPTER_UNAVAILABLE:${agent.transport}`);
        return { ok: false, payload: undefined, usage: unknownUsage, attempt };
      }

      const probed = await this.probeAdapter(agent.transport);
      if (probed.status !== 'available') {
        const attempt = failedAttempt(`ADAPTER_UNAVAILABLE:${agent.transport}`);
        return { ok: false, payload: undefined, usage: unknownUsage, attempt };
      }

      const result = await selected.run(envelope, agentInput, controller.signal, () => undefined);
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
      const attempt = record({
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
      });
      return { ok: succeeded, payload, usage: succeeded ? safeResult.value.usage : unknownUsage, attempt };
    };

    const runTaskPipeline = async (
      task: OrchTask,
      worker: OrchRun['agents'][number],
      rev: OrchRun['agents'][number],
    ): Promise<void> => {
      let current: OrchTask = { ...task, state: 'assigned' };
      tasks = tasks.map((t) => (t.id === current.id ? current : t));
      persist();

      current = { ...current, state: 'running' };
      tasks = tasks.map((t) => (t.id === current.id ? current : t));
      persist();

      const resume = resumes.get(task.id);
      let passed = false;
      let fixCount = 0;
      let findings: readonly unknown[] = resume?.findings ?? [];
      // A worker attempt that finished before the engine stopped is reviewed, not redone.
      let reviewOnly = resume?.reviewPending === true && taskWorktrees.has(task.id);

      while (!passed && calls < run.limits.maxAgentCalls && !stopped()) {
        let workerOutput: unknown = null;
        if (!reviewOnly) {
          const work = await invoke(current, worker, 'worker', { task: current, findings });
          current = { ...current, attempts: [...current.attempts, work.attempt.id] };
          if (stopped()) {
            break;
          }
          if (!work.ok) {
            current = { ...current, state: 'failed', stateReason: work.attempt.reason ?? 'WORKER_FAILED' };
            break;
          }
          workerOutput = work.payload;
        }
        reviewOnly = false;

        current = { ...current, state: 'awaiting_handoff' as const };
        current = { ...current, state: 'in_review' as const };
        tasks = tasks.map((t) => (t.id === current.id ? current : t));
        persist();

        const tw = taskWorktrees.get(current.id);
        const reviewDiff =
          this.deps.workspace === undefined || tw === undefined ? undefined : await this.deps.workspace.diff(tw);
        const review = await invoke(current, rev, 'reviewer', {
          task: current,
          workerOutput,
          previousFindings: findings,
          ...(reviewDiff?.ok ? { diff: reviewDiff.value } : {}),
        });
        current = { ...current, attempts: [...current.attempts, review.attempt.id] };
        if (stopped()) {
          break;
        }

        const validVerdict = isVerdict(review.payload);
        // Keep the reviewer's findings on the attempt so the owner can see why a fix was required.
        update(
          review.attempt.id,
          validVerdict
            ? { verdict: storedVerdict(review.payload as Verdict) }
            : { state: 'failed', reason: 'REVIEW_INVALID' },
        );
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
      persist();
    };

    /** The supervisor's final review is a gate: only an explicit, valid `approveForOwner: true` passes. */
    const finalReview = async (integrationDiff: string, evidence: readonly CommandRun[]): Promise<boolean> => {
      const anchor = tasks[0];
      if (supervisor === undefined || anchor === undefined) {
        control.pauseReason = 'FINAL_REVIEW_UNAVAILABLE';
        return false;
      }
      const review = await invoke(anchor, supervisor, 'supervisor', {
        kind: 'final-review',
        integrationDiff,
        evidence,
      });
      if (stopped()) return false;
      const parsed = review.ok ? finalReviewSchema.safeParse(review.payload) : undefined;
      if (parsed?.success !== true) {
        update(
          review.attempt.id,
          review.ok ? { evidence, state: 'failed', reason: 'FINAL_REVIEW_INVALID' } : { evidence },
        );
        control.pauseReason = review.ok ? 'FINAL_REVIEW_INVALID' : 'FINAL_REVIEW_FAILED';
        return false;
      }
      update(review.attempt.id, { evidence, verdict: storedFinalReview(parsed.data) });
      if (!parsed.data.approveForOwner) {
        control.pauseReason = 'FINAL_REVIEW_REJECTED';
        return false;
      }
      return true;
    };

    /** Asks the reviewer (read-only) for the resolved content of every conflicted file; the engine applies it. */
    const resolveConflict = async (
      taskId: string,
      integration: Worktree,
      conflict: MergeConflict,
    ): Promise<{ readonly attemptId?: string; readonly resolutions?: readonly ConflictResolution[] }> => {
      const task = tasks.find((item) => item.id === taskId);
      if (reviewer === undefined || task === undefined) return {};
      const review = await invoke(
        task,
        reviewer,
        'reviewer',
        {
          kind: 'integration-conflict',
          task: { id: task.id, title: task.title, objective: task.objective },
          conflictedFiles: conflict.files,
          diff: conflict.diff,
        },
        integration,
      );
      const parsed = review.ok ? conflictResolutionSchema.safeParse(review.payload) : undefined;
      const changedFiles = conflict.files.map((file) => file.path);
      update(
        review.attempt.id,
        review.ok && parsed?.success !== true
          ? { changedFiles, state: 'failed', reason: 'CONFLICT_RESOLUTION_INVALID' }
          : { changedFiles },
      );
      return parsed?.success === true
        ? { attemptId: review.attempt.id, resolutions: parsed.data.resolutions }
        : { attemptId: review.attempt.id };
    };

    /** Merges every completed task into a fresh integration branch, validates it and asks for the final review. */
    const integrateAndReview = async (): Promise<boolean> => {
      const workspace = this.deps.workspace;
      if (workspace === undefined) return finalReview('', []);
      const prepared = await workspace.prepareIntegration(snapshot());
      if (!prepared.ok) {
        if (prepared.error.code === ErrorCode.TARGET_FORBIDDEN) control.fatalFailureReason = 'TARGET_FORBIDDEN';
        else control.pauseReason = 'INTEGRATION_FAILED';
        return false;
      }
      const integration = prepared.value;
      extras.integrationBranch = integration.branch;
      extras.integrationBaseSha = integration.baseSha;
      persist();
      let head: string | undefined;
      const completed = topologicalOrder(
        specs.filter((spec) => tasks.some((task) => task.id === spec.id && task.state === 'completed')),
      );
      for (const spec of completed) {
        const source = taskWorktrees.get(spec.id);
        // A completed task whose change cannot be found must never be dropped from the merge silently.
        if (source === undefined) {
          control.pauseReason = 'INTEGRATION_SOURCE_MISSING';
          return false;
        }
        const conflictAttempt: { id?: string } = {};
        const merged = await workspace.mergeTask(snapshot(), integration, source, async (conflict) => {
          const resolved = await resolveConflict(spec.id, integration, conflict);
          if (resolved.attemptId !== undefined) conflictAttempt.id = resolved.attemptId;
          return resolved.resolutions;
        });
        if (stopped()) return false;
        if (!merged.ok) {
          control.pauseReason = 'INTEGRATION_FAILED';
          return false;
        }
        if (merged.value.conflict && merged.value.resolved !== true) {
          const attempt = attempts.find((item) => item.id === conflictAttempt.id);
          if (attempt?.state === 'succeeded' && merged.value.reason !== undefined)
            update(attempt.id, { state: 'failed', reason: merged.value.reason });
          control.pauseReason = 'INTEGRATION_CONFLICT';
          return false;
        }
        head = merged.value.headSha ?? head;
      }
      const validation = await workspace.validateIntegration(
        snapshot(),
        integration,
        distinctCommands(run.tasks.flatMap((task) => task.testCommands)),
      );
      const evidence = validation.ok ? validation.value : [];
      if (!validation.ok || evidence.some((item) => item.exitCode !== 0 || item.timedOut)) {
        control.pauseReason = 'INTEGRATION_VALIDATION_FAILED';
        return false;
      }
      const diff = await workspace.diff(integration);
      if (!diff.ok) {
        control.pauseReason = 'INTEGRATION_FAILED';
        return false;
      }
      const approved = await finalReview(diff.value, evidence);
      if (approved && head !== undefined) extras.integrationHeadSha = head;
      return approved;
    };

    // Parallel worker pool
    const inFlight = new Map<string, Promise<void>>();
    const runningTaskIds = new Set<string>();

    while (!stopped()) {
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

    const allComplete = tasks.length > 0 && tasks.every((t) => t.state === 'completed');
    const readyForOwner = allComplete && !stopped() && (await integrateAndReview());

    this.attemptsByRun.set(run.id, attempts);
    this.controllers.delete(run.id);

    const isCancelled = isAborted();
    const fatal = isFatal();
    // AWAITING_APPROVAL only when every task passed review, integration merged and validated, and the
    // supervisor explicitly approved it for the owner.
    const isAwaitingApproval = readyForOwner && !isCancelled && !fatal && !isPaused();

    const result: OrchRun = {
      ...snapshot(),
      state: isCancelled ? 'cancelled' : fatal ? 'failed' : isAwaitingApproval ? 'awaiting_approval' : 'paused',
    };
    if (isCancelled) {
      return { ...result, stateReason: 'CANCELLED' };
    }
    if (fatal && control.fatalFailureReason !== undefined) {
      return { ...result, stateReason: control.fatalFailureReason };
    }
    if (isAwaitingApproval) {
      return result;
    }
    return { ...result, stateReason: control.pauseReason ?? 'TASK_FAILURE' };
  }
}

export type { OrchTaskSpec };
