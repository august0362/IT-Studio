import { describe, expect, it } from 'vitest';
import type { MicroUsd, OrchAttempt, OrchRun, OrchTask } from '@itstudio/schemas';
import { openDatabase } from '../../../kernel/infra/sqlite/database.js';
import { projects } from '../../../kernel/infra/sqlite/schema.js';
import { OrchRepository } from './orch-repository.js';

function run(id: string): OrchRun {
  const task: OrchTask = {
    id: 'T1' as OrchTask['id'],
    title: 'Task',
    objective: 'Do it',
    dependsOn: [],
    role: 'worker',
    candidateAgents: ['w'],
    allowedPaths: ['src/**'],
    testCommands: [],
    acceptanceCriteria: ['done'],
    estimate: 'S',
    timeoutMs: 1000,
    state: 'ready',
    fixRounds: 0,
    attempts: [],
  };
  return {
    id: id as OrchRun['id'],
    projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrchRun['projectId'],
    request: 'request',
    state: 'plan_ready',
    agents: [],
    tasks: [task],
    limits: {
      maxCostMicroUsd: 1 as MicroUsd,
      maxWallClockMs: 1,
      maxAgentCalls: 1,
      maxConcurrentWorkers: 1,
      maxFixRounds: 0,
      transientRetries: 0,
      hardStop: true,
    },
    targetBranch: 'main',
    costMicroUsd: 0 as MicroUsd,
    agentCalls: 0,
    createdAt: '2026-10-20T00:00:00.000Z' as OrchRun['createdAt'],
    updatedAt: '2026-10-20T00:00:00.000Z' as OrchRun['updatedAt'],
  };
}

function attempt(id: string): OrchAttempt {
  return {
    id: id as OrchAttempt['id'],
    taskId: null,
    role: 'supervisor',
    agent: { agentId: 's', role: 'supervisor', transport: 'claude-cli' },
    state: 'succeeded',
    changedFiles: [],
    evidence: [],
    usage: {
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      reasoningTokens: null,
      source: 'unknown',
      costMicroUsd: null,
      billing: 'unknown',
    },
    startedAt: '2026-10-20T00:00:00.000Z' as OrchAttempt['startedAt'],
  };
}

describe('OrchRepository', () => {
  it('stores several runs whose plans reuse the same task ids', () => {
    const database = openDatabase(':memory:');
    database.db
      .insert(projects)
      .values({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'p',
        workspaceRoot: 'C:/p',
        createdAt: '2026-10-20T00:00:00.000Z',
      })
      .run();
    const repository = new OrchRepository(database.db);
    repository.save(run('run-1'), [attempt('a-1')]);
    repository.save(run('run-2'), [attempt('a-2')]);
    repository.save({ ...run('run-1'), state: 'running' });
    expect(repository.get('run-1')?.state).toBe('running');
    expect(repository.get('run-2')?.tasks.map((task) => task.id)).toEqual(['T1']);
    expect(repository.attempts('run-2').map((item) => item.id)).toEqual(['a-2']);
    // Later saves update known attempts (restart sweep, review verdict) instead of dropping the change.
    repository.save(run('run-2'), [{ ...attempt('a-2'), state: 'unknown', reason: 'INTERRUPTED' }]);
    expect(repository.attempts('run-2')).toEqual([{ ...attempt('a-2'), state: 'unknown', reason: 'INTERRUPTED' }]);
  });
});
