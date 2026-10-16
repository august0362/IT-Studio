import { describe, expect, it } from 'vitest';
import type { OrchRun } from '@itstudio/schemas';
import { MockAgentAdapter } from '../../src/modules/orchestration/adapters/mock-adapter.js';
import { OrchestrationEngine } from '../../src/modules/orchestration/engine.js';
describe('orchestration integration smoke', () => {
  it('ORCH-001 plans, starts and reaches awaiting_approval after mock review pass', async () => {
    const engine = new OrchestrationEngine({
      adapter: new MockAgentAdapter({
        reviewer: () => Promise.resolve({ verdict: 'pass', findings: [], summary: 'ok' }),
      }),
      validate: { workspaceRoot: '/workspace', allowedCommands: [] },
    });
    const validated = await engine.plan({
      tasks: [
        {
          id: 'T1',
          title: 'smoke',
          objective: 'complete',
          dependsOn: [],
          role: 'worker',
          candidateAgents: ['w'],
          allowedPaths: ['src/**'],
          testCommands: [],
          acceptanceCriteria: ['done'],
          estimate: 'S',
          timeoutMs: 1000,
        },
      ],
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error('plan invalid');
    const spec = validated.value[0];
    if (spec === undefined) throw new Error('missing task');
    const run: OrchRun = {
      id: 'run-1' as OrchRun['id'],
      projectId: 'project-1' as OrchRun['projectId'],
      request: 'smoke',
      state: 'plan_ready',
      agents: [
        { agentId: 's', role: 'supervisor', transport: 'mock' },
        { agentId: 'w', role: 'worker', transport: 'mock' },
        { agentId: 'w2', role: 'worker', transport: 'mock' },
        { agentId: 'r', role: 'reviewer', transport: 'mock' },
      ],
      tasks: [{ ...spec, state: 'ready', fixRounds: 0, attempts: [] }],
      limits: {
        maxCostMicroUsd: 2_000_000 as OrchRun['limits']['maxCostMicroUsd'],
        maxWallClockMs: 3_600_000,
        maxAgentCalls: 40,
        maxConcurrentWorkers: 2,
        maxFixRounds: 2,
        transientRetries: 1,
        hardStop: false,
      },
      targetBranch: 'main',
      costMicroUsd: 0 as OrchRun['costMicroUsd'],
      agentCalls: 0,
      createdAt: new Date().toISOString() as OrchRun['createdAt'],
      updatedAt: new Date().toISOString() as OrchRun['updatedAt'],
    };
    const result = await engine.run(run);
    expect(result.state).toBe('awaiting_approval');
    expect(engine.attempts(run.id).map((attempt) => attempt.role)).toEqual(['worker', 'reviewer']);
  });
  it('ORCH-009 retries once after fix_required and pauses after the bounded fix rounds', async () => {
    const engine = new OrchestrationEngine({
      adapter: new MockAgentAdapter({
        reviewer: () =>
          Promise.resolve({
            verdict: 'fix_required',
            findings: [{ severity: 'error', path: 'src/a.ts', message: 'issue', suggestedFix: 'correct it' }],
            summary: 'fix',
          }),
        supervisor: () => Promise.resolve({ decision: 'reassign' }),
      }),
      validate: { workspaceRoot: '/workspace', allowedCommands: [] },
      id: (() => {
        let id = 0;
        return () => `attempt-${String(++id)}`;
      })(),
    });
    const spec = {
      id: 'T1' as OrchRun['tasks'][number]['id'],
      title: 'task',
      objective: 'work',
      dependsOn: [],
      role: 'worker' as const,
      candidateAgents: ['w'],
      allowedPaths: ['src/**'],
      testCommands: [],
      acceptanceCriteria: ['done'],
      estimate: 'S' as const,
      timeoutMs: 1000,
    };
    const now = new Date().toISOString() as OrchRun['createdAt'];
    const run: OrchRun = {
      id: 'run-fix' as OrchRun['id'],
      projectId: 'project-1' as OrchRun['projectId'],
      request: 'fix',
      state: 'plan_ready',
      agents: [
        { agentId: 's', role: 'supervisor', transport: 'mock' },
        { agentId: 'w', role: 'worker', transport: 'mock' },
        { agentId: 'w2', role: 'worker', transport: 'mock' },
        { agentId: 'r', role: 'reviewer', transport: 'mock' },
      ],
      tasks: [{ ...spec, state: 'ready', fixRounds: 0, attempts: [] }],
      limits: {
        maxCostMicroUsd: 2_000_000 as OrchRun['limits']['maxCostMicroUsd'],
        maxWallClockMs: 3_600_000,
        maxAgentCalls: 40,
        maxConcurrentWorkers: 2,
        maxFixRounds: 1,
        transientRetries: 1,
        hardStop: false,
      },
      targetBranch: 'main',
      costMicroUsd: 0 as OrchRun['costMicroUsd'],
      agentCalls: 0,
      createdAt: now,
      updatedAt: now,
    };
    const result = await engine.run(run);
    expect(result.state).toBe('paused');
    expect(result.stateReason).toBe('NEEDS_OWNER');
    expect(engine.attempts(run.id).filter((attempt) => attempt.role === 'worker')).toHaveLength(2);
    expect(engine.attempts(run.id).filter((attempt) => attempt.role === 'supervisor')).toHaveLength(1);
  });
});
