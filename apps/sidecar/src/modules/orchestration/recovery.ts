import { basename } from 'node:path';
import type { OrchAttempt, OrchTask } from '@itstudio/schemas';
import type { Worktree } from './worktrees.js';

/** Task states that only exist while an engine is working on the task. */
const IN_FLIGHT: readonly OrchTask['state'][] = [
  'assigned',
  'running',
  'awaiting_handoff',
  'in_review',
  'integrating',
  'validating',
];

/** Restart sweep for a run whose engine died: in-flight tasks become queued again, running attempts unknown. */
export function interruptedTasks(tasks: readonly OrchTask[]): readonly OrchTask[] {
  return tasks.map((task) =>
    IN_FLIGHT.includes(task.state) ? { ...task, state: 'queued' as const, stateReason: 'INTERRUPTED' } : task,
  );
}

export function interruptedAttempts(attempts: readonly OrchAttempt[]): readonly OrchAttempt[] {
  return attempts.map((attempt) =>
    attempt.state === 'running' ? { ...attempt, state: 'unknown' as const, reason: 'INTERRUPTED' } : attempt,
  );
}

/**
 * A (re)started run keeps completed tasks; every other task is queued again and gets new attempt ids.
 * The previous reason is dropped so the task shows why it stops this time, not last time.
 */
export function requeueUnfinished(tasks: readonly OrchTask[]): OrchTask[] {
  return tasks.map((task) => {
    if (task.state === 'completed') return task;
    const queued: OrchTask = { ...task, state: 'queued' };
    Reflect.deleteProperty(queued, 'stateReason');
    return queued;
  });
}

/** Worktree `.itstudio/orch/<run>/<name>` always has branch `itstudio/orch/<run>/<name>`. */
export function attemptWorktree(runId: string, attempt: OrchAttempt): Worktree | undefined {
  if (attempt.worktree === undefined) return undefined;
  return {
    path: attempt.worktree,
    branch: `itstudio/orch/${runId}/${basename(attempt.worktree)}`,
    baseSha: attempt.baseSha ?? '',
  };
}

export interface TaskResume {
  /** Worktree of the task's last successful worker attempt (the change a completed task contributes). */
  readonly worktree?: Worktree;
  /** The last successful worker attempt was never reviewed: review it instead of calling the worker again. */
  readonly reviewPending: boolean;
  /** The last successful worker attempt already passed review (the engine stopped before saving the task). */
  readonly reviewPassed: boolean;
  /** Findings of the last review when it asked for a fix; the next worker attempt must resolve them. */
  readonly findings: NonNullable<OrchAttempt['verdict']>['findings'];
  /** Worker attempts already used by the task; the next one gets the next number (and worktree name). */
  readonly workerAttempts: number;
}

/** Where a task continues, from the attempts persisted in earlier engine sessions (in creation order). */
export function taskResume(runId: string, taskId: string, history: readonly OrchAttempt[]): TaskResume {
  const own = history.filter((attempt) => attempt.taskId === taskId);
  const workers = own.filter((attempt) => attempt.role === 'worker');
  let lastWorker = -1;
  own.forEach((attempt, index) => {
    if (attempt.role === 'worker' && attempt.state === 'succeeded' && attempt.worktree !== undefined)
      lastWorker = index;
  });
  const review = own
    .slice(lastWorker + 1)
    .filter((attempt) => attempt.role === 'reviewer' && attempt.state === 'succeeded' && attempt.verdict !== undefined)
    .at(-1);
  const lastVerdict = own
    .filter((attempt) => attempt.role === 'reviewer' && attempt.verdict !== undefined)
    .at(-1)?.verdict;
  const worker = own[lastWorker];
  const worktree = worker === undefined ? undefined : attemptWorktree(runId, worker);
  return {
    ...(worktree === undefined ? {} : { worktree }),
    reviewPending: worktree !== undefined && review === undefined,
    reviewPassed: worktree !== undefined && review?.verdict?.verdict === 'pass',
    findings: lastVerdict?.verdict === 'fix_required' ? lastVerdict.findings : [],
    workerAttempts: workers.length,
  };
}
