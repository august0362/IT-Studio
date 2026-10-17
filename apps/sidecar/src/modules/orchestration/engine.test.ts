import { describe, expect, it, vi } from 'vitest';
import type { MicroUsd, OrchAgentRef, OrchRun, OrchTask, ProjectId } from '@itstudio/schemas';
import { OrchestrationEngine } from './engine.js';
import type { IAgentExecutionAdapter } from '../../ports/agent-execution.js';
import { OrchWorkspace, type IOrchWorkspace } from './workspace.js';
import type { Worktree } from './worktrees.js';

const worker: OrchAgentRef = { agentId: 'worker-1', role: 'worker', transport: 'mock' };
const reviewer: OrchAgentRef = { agentId: 'reviewer-1', role: 'reviewer', transport: 'mock' };
function makeRun(): OrchRun {
  const task: OrchTask = {
    id: 'task-1' as OrchTask['id'],
    title: 'Task',
    objective: 'Do it',
    dependsOn: [],
    role: 'worker',
    candidateAgents: ['worker-1'],
    allowedPaths: ['src/**'],
    testCommands: [],
    acceptanceCriteria: ['Done'],
    estimate: 'S',
    timeoutMs: 1000,
    state: 'ready',
    fixRounds: 0,
    attempts: [],
    assignedAgentId: worker.agentId,
  };
  return {
    id: 'run-1' as OrchRun['id'],
    projectId: 'project-1' as ProjectId,
    request: 'Request',
    state: 'plan_ready',
    agents: [worker, reviewer],
    tasks: [task],
    limits: {
      maxCostMicroUsd: 1_000_000 as MicroUsd,
      maxWallClockMs: 10_000,
      maxAgentCalls: 10,
      maxConcurrentWorkers: 1,
      maxFixRounds: 1,
      transientRetries: 0,
      hardStop: false,
    },
    targetBranch: 'main',
    costMicroUsd: 0 as MicroUsd,
    agentCalls: 0,
    createdAt: '2026-01-01T00:00:00.000Z' as OrchRun['createdAt'],
    updatedAt: '2026-01-01T00:00:00.000Z' as OrchRun['updatedAt'],
  };
}
function fakeAdapter(run: IAgentExecutionAdapter['run']): IAgentExecutionAdapter {
  return {
    id: 'mock',
    probe: async () => ({ status: 'available' }),
    capabilities: () => ({
      roles: ['worker', 'reviewer', 'supervisor'],
      structuredOutput: true,
      usage: false,
      cancel: true,
    }),
    run,
  };
}
const validReview = { verdict: 'pass', findings: [], summary: 'Looks good' };
const validWorker = { operations: [], summary: 'Done', assumptions: [] };
const noValidation = { workspaceRoot: '.', allowedCommands: [] };
const wt: Worktree = {
  path: 'C:/repo/.itstudio/orch/run-1/task-1-1',
  branch: 'itstudio/orch/run-1/task-1',
  baseSha: 'base',
};
function fakeWorkspace(overrides: Partial<IOrchWorkspace> = {}): IOrchWorkspace {
  return {
    prepareAttempt: async () => ({ ok: true, value: wt }),
    applyWorker: async () => ({
      ok: true,
      value: { changedFiles: ['src/a.ts'], baseSha: 'base', headSha: 'head', evidence: [] },
    }),
    diff: async () => ({ ok: true, value: 'diff' }),
    ...overrides,
  };
}

describe('orchestration engine', () => {
  it('ORCH-005 assigns isolated worktree and rejects mismatched acknowledgement before apply', async () => {
    const apply = vi.fn();
    let workerEnvelope: Parameters<IAgentExecutionAdapter['run']>[0] | undefined;
    const adapter = fakeAdapter(async (envelope) => {
      if (envelope.roleId === 'worker') {
        workerEnvelope = envelope;
        return {
          ok: true,
          value: {
            ack: {
              ack: true,
              roleId: 'reviewer',
              taskId: envelope.taskId,
              attemptId: envelope.attemptId,
              allowedPaths: envelope.allowedPaths,
            },
            payload: validWorker,
            usage: {
              inputTokens: null,
              outputTokens: null,
              cachedInputTokens: null,
              reasoningTokens: null,
              source: 'unknown',
              costMicroUsd: null,
              billing: 'unknown',
            },
          },
        };
      }
      return {
        ok: true,
        value: {
          ack: {
            ack: true,
            roleId: envelope.roleId,
            taskId: envelope.taskId,
            attemptId: envelope.attemptId,
            allowedPaths: envelope.allowedPaths,
          },
          payload: validReview,
          usage: {
            inputTokens: null,
            outputTokens: null,
            cachedInputTokens: null,
            reasoningTokens: null,
            source: 'unknown',
            costMicroUsd: null,
            billing: 'unknown',
          },
        },
      };
    });
    const engine = new OrchestrationEngine({
      adapters: new Map([['mock', adapter]]),
      validate: noValidation,
      id: (() => {
        let i = 0;
        return () => `attempt-${++i}`;
      })(),
      workspace: fakeWorkspace({ applyWorker: apply }),
    });
    await engine.run(makeRun());
    expect(workerEnvelope).toMatchObject({
      roleId: 'worker',
      allowedPaths: ['src/**'],
      assignedWorktree: wt.path,
      attemptId: 'attempt-1',
      forbiddenActions: [],
    });
    expect(engine.attempts('run-1')[0]).toMatchObject({ state: 'failed', reason: 'ROLE_ACK_MISMATCH' });
    expect(apply).not.toHaveBeenCalled();
  });

  it('ORCH-006 (unit) fails the task when applying worker output is denied', async () => {
    const adapter = fakeAdapter(async (envelope) => ({
      ok: true,
      value: {
        ack: {
          ack: true,
          roleId: envelope.roleId,
          taskId: envelope.taskId,
          attemptId: envelope.attemptId,
          allowedPaths: envelope.allowedPaths,
        },
        payload: envelope.roleId === 'worker' ? validWorker : validReview,
        usage: {
          inputTokens: null,
          outputTokens: null,
          cachedInputTokens: null,
          reasoningTokens: null,
          source: 'unknown',
          costMicroUsd: null,
          billing: 'unknown',
        },
      },
    }));
    const engine = new OrchestrationEngine({
      adapters: new Map([['mock', adapter]]),
      validate: noValidation,
      workspace: fakeWorkspace({
        applyWorker: async () => ({ ok: false, error: { code: 'PATH_DENIED', message: 'Denied', retryable: false } }),
      }),
    });
    const result = await engine.run(makeRun());
    expect(result.tasks[0]).toMatchObject({ state: 'failed' });
    expect(engine.attempts('run-1')[0]).toMatchObject({ state: 'failed', reason: 'PATH_DENIED' });
    expect(engine.attempts('run-1')).toHaveLength(1);
  });

  it('REVIEW_INVALID fails each invalid review and escalates after max fix rounds', async () => {
    const adapter = fakeAdapter(async (envelope) => ({
      ok: true,
      value: {
        ack: {
          ack: true,
          roleId: envelope.roleId,
          taskId: envelope.taskId,
          attemptId: envelope.attemptId,
          allowedPaths: envelope.allowedPaths,
        },
        payload: envelope.roleId === 'worker' ? validWorker : {},
        usage: {
          inputTokens: null,
          outputTokens: null,
          cachedInputTokens: null,
          reasoningTokens: null,
          source: 'unknown',
          costMicroUsd: null,
          billing: 'unknown',
        },
      },
    }));
    const engine = new OrchestrationEngine({
      adapters: new Map([['mock', adapter]]),
      validate: noValidation,
      workspace: fakeWorkspace(),
    });
    const result = await engine.run(makeRun());
    expect(result).toMatchObject({
      state: 'paused',
      stateReason: 'NEEDS_OWNER',
      tasks: [{ state: 'fix_required', stateReason: 'NEEDS_OWNER', fixRounds: 2 }],
    });
    expect(engine.attempts('run-1').filter((attempt) => attempt.role === 'reviewer')).toHaveLength(2);
    expect(engine.attempts('run-1').filter((attempt) => attempt.role === 'reviewer')).toEqual(
      expect.arrayContaining([expect.objectContaining({ state: 'failed', reason: 'REVIEW_INVALID' })]),
    );
  });
});

describe('OrchWorkspace', () => {
  it('caches the first base SHA for all attempts in a run', async () => {
    const runner = {
      run: vi.fn(async () => ({
        ok: true as const,
        value: { exitCode: 0, timedOut: false, durationMs: 1, stdoutTail: 'sha-one\n', stderrTail: '' },
      })),
    };
    const create = vi.fn(async (_root: string, identity: { readonly baseSha: string; readonly attempt: number }) => ({
      ok: true as const,
      value: { ...wt, baseSha: identity.baseSha },
    }));
    const workspace = new OrchWorkspace({
      projects: {
        get: async () => ({
          id: 'project-1' as ProjectId,
          workspaceRoot: 'C:/repo',
          name: 'Repo',
          createdAt: '2026-01-01T00:00:00.000Z' as OrchRun['createdAt'],
          archived: false,
        }),
      },
      worktrees: { create } as never,
      apply: {} as never,
      runner,
    });
    const run = makeRun();
    await workspace.prepareAttempt(run, run.tasks[0]!, 1);
    runner.run.mockResolvedValueOnce({
      ok: true,
      value: { exitCode: 0, timedOut: false, durationMs: 1, stdoutTail: 'sha-two\n', stderrTail: '' },
    });
    await workspace.prepareAttempt(run, run.tasks[0]!, 2);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(create.mock.calls.map(([, identity]) => identity.baseSha)).toEqual(['sha-one', 'sha-one']);
  });
});
