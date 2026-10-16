import { describe, expect, it } from 'vitest';
import type { OrchTask, OrchTaskSpec } from '@itstudio/schemas';
import { blockFailedDependents, markPathLockedTasks, pickRunnable } from './scheduler.js';
import { pathsOverlap } from './path-locks.js';
const task = (id: string, deps: string[] = [], state: OrchTask['state'] = 'queued', paths = ['src/**']): OrchTask => ({
  id: id as OrchTask['id'],
  title: id,
  objective: 'work',
  dependsOn: deps.map((item) => item as OrchTask['id']),
  role: 'worker',
  candidateAgents: ['w'],
  allowedPaths: paths,
  testCommands: [],
  acceptanceCriteria: ['ok'],
  estimate: 'S',
  timeoutMs: 1000,
  state,
  fixRounds: 0,
  attempts: [],
});
describe('orchestration scheduler', () => {
  it('ORCH-003 holds overlapping path locks until review ends', () => {
    expect(pathsOverlap('src/**', 'src/a.ts')).toBe(true);
    const tasks = [task('T1', [], 'in_review'), task('T2')];
    expect(
      pickRunnable(
        tasks,
        tasks,
        { maxConcurrentWorkers: 2, maxCostMicroUsd: 100, maxAgentCalls: 10 },
        { costMicroUsd: 0, agentCalls: 0 },
      ),
    ).toEqual([]);
    expect(markPathLockedTasks(tasks, tasks).find((item) => item.id === 'T2')?.stateReason).toBe('PATH_LOCK');
    expect(
      pickRunnable(
        tasks,
        tasks,
        { maxConcurrentWorkers: 2, maxCostMicroUsd: 100, maxAgentCalls: 10 },
        { costMicroUsd: 0, agentCalls: 0 },
      ),
    ).toEqual([]);
  });
  it('ORCH-004 blocks only transitive dependents and leaves independent work runnable', () => {
    const resolved = blockFailedDependents([task('T1', [], 'failed'), task('T2', ['T1']), task('T3')]);
    expect(resolved.map((item) => item.state)).toEqual(['failed', 'blocked', 'queued']);
  });
  it('schedules longest critical path first with stable id tie breaking', () => {
    const tasks = [task('T1'), task('T2'), task('T3', ['T2'])];
    expect(
      pickRunnable(
        tasks,
        tasks as readonly OrchTaskSpec[],
        { maxConcurrentWorkers: 1, maxCostMicroUsd: 100, maxAgentCalls: 10 },
        { costMicroUsd: 0, agentCalls: 0 },
      ),
    ).toEqual(['T2']);
  });
});
