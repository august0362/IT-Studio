import type { OrchTask, OrchTaskSpec } from '@itstudio/schemas';
import { criticalPathLengths } from './dag.js';
import { pathSetsOverlap } from './path-locks.js';
export interface SchedulerLimits {
  readonly maxConcurrentWorkers: number;
  readonly maxCostMicroUsd: number;
  readonly maxAgentCalls: number;
}
export interface SchedulerUsage {
  readonly costMicroUsd: number;
  readonly agentCalls: number;
}
export function pickRunnable(
  tasks: readonly OrchTask[],
  specs: readonly OrchTaskSpec[],
  limits: SchedulerLimits,
  usage: SchedulerUsage,
): readonly string[] {
  if (usage.costMicroUsd >= limits.maxCostMicroUsd || usage.agentCalls >= limits.maxAgentCalls) return [];
  const active = tasks.filter((task) =>
    ['running', 'in_review', 'awaiting_handoff', 'fix_required'].includes(task.state),
  );
  const slots = Math.max(
    0,
    limits.maxConcurrentWorkers -
      active.filter((task) => task.state === 'running' || task.state === 'awaiting_handoff').length,
  );
  const blocked = blockFailedDependents(tasks);
  const completed = new Set(blocked.filter((task) => task.state === 'completed').map((task) => task.id));
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const lengths = criticalPathLengths(specs);
  return blocked
    .filter(
      (task) =>
        task.state === 'queued' &&
        task.dependsOn.every((dep) => completed.has(dep)) &&
        !active.some((other) => {
          const a = byId.get(task.id);
          const b = byId.get(other.id);
          return a !== undefined && b !== undefined && pathSetsOverlap(a.allowedPaths, b.allowedPaths);
        }),
    )
    .sort((a, b) => (lengths.get(b.id) ?? 0) - (lengths.get(a.id) ?? 0) || a.id.localeCompare(b.id))
    .slice(0, slots)
    .map((task) => task.id);
}
export function blockFailedDependents(tasks: readonly OrchTask[]): readonly OrchTask[] {
  const failed = new Set(
    tasks.filter((task) => task.state === 'failed' || task.state === 'blocked').map((task) => task.id),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks)
      if (!failed.has(task.id) && task.dependsOn.some((dep) => failed.has(dep))) {
        failed.add(task.id);
        changed = true;
      }
  }
  return tasks.map((task) =>
    failed.has(task.id) && task.state !== 'failed' && task.state !== 'blocked'
      ? { ...task, state: 'blocked', stateReason: 'DEPENDENCY_FAILED' }
      : task,
  );
}
export function markPathLockedTasks(tasks: readonly OrchTask[], specs: readonly OrchTaskSpec[]): readonly OrchTask[] {
  const active = tasks.filter((task) =>
    ['running', 'awaiting_handoff', 'in_review', 'fix_required'].includes(task.state),
  );
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  return tasks.map((task) => {
    if (task.state !== 'queued') return task;
    const spec = byId.get(task.id);
    const locked =
      spec !== undefined &&
      active.some((other) => {
        const otherSpec = byId.get(other.id);
        return otherSpec !== undefined && pathSetsOverlap(spec.allowedPaths, otherSpec.allowedPaths);
      });
    return locked ? { ...task, stateReason: 'PATH_LOCK' } : task;
  });
}
