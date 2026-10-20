import { describe, expect, it, vi } from 'vitest';
import type { MicroUsd, OrchAgentRef, OrchAttempt, OrchRun, OrchTask, ProjectId } from '@itstudio/schemas';
import { OrchestrationEngine } from './engine.js';
import type { IAgentExecutionAdapter } from '../../kernel/ports/agent-execution.js';
import { OrchWorkspace, type IOrchWorkspace } from './workspace.js';
import type { Worktree } from './worktrees.js';
import { createOrchestrationModule } from './index.js';
import type { OrchRepository } from './storage/orch-repository.js';

const worker: OrchAgentRef = { agentId: 'worker-1', role: 'worker', transport: 'mock' };
const reviewer: OrchAgentRef = { agentId: 'reviewer-1', role: 'reviewer', transport: 'mock' };
const unknownUsage = {
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  reasoningTokens: null,
  source: 'unknown' as const,
  costMicroUsd: null,
  billing: 'unknown' as const,
};

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
    probe: () => Promise.resolve({ status: 'available' as const }),
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
const noValidation = { workspaceRoot: 'C:/mock-repo', allowedCommands: [] };
const wt: Worktree = {
  path: 'C:/repo/.itstudio/orch/run-1/task-1-1',
  branch: 'itstudio/orch/run-1/task-1-1',
  baseSha: 'base',
};

function fakeWorkspace(overrides: Partial<IOrchWorkspace> = {}): IOrchWorkspace {
  return {
    prepareAttempt: () => Promise.resolve({ ok: true as const, value: wt }),
    prepareIntegration: () =>
      Promise.resolve({
        ok: true as const,
        value: {
          path: 'C:/repo/.itstudio/orch/run-1/integration',
          branch: 'itstudio/orch/run-1/integration',
          baseSha: 'base',
        },
      }),
    mergeTask: () => Promise.resolve({ ok: true as const, value: { exitCode: 0, conflict: false } }),
    validateIntegration: () => Promise.resolve({ ok: true as const, value: [] }),
    applyWorker: () =>
      Promise.resolve({
        ok: true as const,
        value: { changedFiles: ['src/a.ts'], baseSha: 'base', headSha: 'head', evidence: [] },
      }),
    diff: () => Promise.resolve({ ok: true as const, value: 'diff' }),
    cleanup: () => Promise.resolve({ ok: true as const, value: undefined }),
    ...overrides,
  };
}

describe('orchestration engine', () => {
  it('ORCH-005 assigns isolated worktree and rejects mismatched acknowledgement before apply', async () => {
    const apply = vi.fn();
    let workerEnvelope: Parameters<IAgentExecutionAdapter['run']>[0] | undefined;
    const adapter = fakeAdapter(async (envelope) => {
      await Promise.resolve();
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
            usage: unknownUsage,
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
          usage: unknownUsage,
        },
      };
    });
    const engine = new OrchestrationEngine({
      adapters: new Map([['mock', adapter]]),
      validate: noValidation,
      id: (() => {
        let i = 0;
        return () => `attempt-${String(++i)}`;
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
    const adapter = fakeAdapter(async (envelope) => {
      await Promise.resolve();
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
          payload: envelope.roleId === 'worker' ? validWorker : validReview,
          usage: unknownUsage,
        },
      };
    });
    const engine = new OrchestrationEngine({
      adapters: new Map([['mock', adapter]]),
      validate: noValidation,
      workspace: fakeWorkspace({
        applyWorker: async () => {
          await Promise.resolve();
          return { ok: false, error: { code: 'PATH_DENIED', message: 'Denied', retryable: false } };
        },
      }),
    });
    const result = await engine.run(makeRun());
    expect(result.tasks[0]).toMatchObject({ state: 'failed' });
    expect(engine.attempts('run-1')[0]).toMatchObject({ state: 'failed', reason: 'PATH_DENIED' });
    expect(engine.attempts('run-1')).toHaveLength(1);
  });

  it('REVIEW_INVALID fails each invalid review and escalates after max fix rounds', async () => {
    const adapter = fakeAdapter(async (envelope) => {
      await Promise.resolve();
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
          payload: envelope.roleId === 'worker' ? validWorker : {},
          usage: unknownUsage,
        },
      };
    });
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

  it('ORCH-014 (unit) unavailable and unsupported adapters are never invoked; run paused', async () => {
    const runWorker = vi.fn(async () => {
      await Promise.resolve();
      return {
        ok: true as const,
        value: {
          ack: {
            ack: true,
            roleId: 'worker' as const,
            taskId: 'task-1',
            attemptId: '1',
            allowedPaths: ['src/**'],
          },
          payload: validWorker,
          usage: unknownUsage,
        },
      };
    });
    const unavailableAdapter: IAgentExecutionAdapter = {
      id: 'mock',
      probe: () => Promise.resolve({ status: 'unavailable', reason: 'Missing binary' }),
      capabilities: () => ({
        roles: ['worker', 'reviewer', 'supervisor'],
        structuredOutput: true,
        usage: false,
        cancel: true,
      }),
      run: runWorker,
    };
    const engine = new OrchestrationEngine({
      adapters: new Map([['mock', unavailableAdapter]]),
      validate: noValidation,
      workspace: fakeWorkspace(),
    });
    const res = await engine.run(makeRun());
    expect(res.state).toBe('paused');
    expect(res.stateReason).toBe('ADAPTER_UNAVAILABLE:mock');
    expect(res.tasks[0]?.state).toBe('queued');
    expect(res.tasks[0]?.stateReason).toBe('ADAPTER_UNAVAILABLE:mock');
    expect(runWorker).not.toHaveBeenCalled();

    const unsupportedAdapter: IAgentExecutionAdapter = {
      id: 'mock',
      probe: () => Promise.resolve({ status: 'unsupported', reason: 'Missing flags' }),
      capabilities: () => ({
        roles: ['worker', 'reviewer', 'supervisor'],
        structuredOutput: true,
        usage: false,
        cancel: true,
      }),
      run: runWorker,
    };
    const engine2 = new OrchestrationEngine({
      adapters: new Map([['mock', unsupportedAdapter]]),
      validate: noValidation,
      workspace: fakeWorkspace(),
    });
    const res2 = await engine2.run(makeRun());
    expect(res2.state).toBe('paused');
    expect(res2.stateReason).toBe('ADAPTER_UNAVAILABLE:mock');
    expect(runWorker).not.toHaveBeenCalled();
  });

  it('ORCH-014 uses the next available candidate worker', async () => {
    const unavailable: IAgentExecutionAdapter = {
      ...fakeAdapter(vi.fn()),
      id: 'codex-cli',
      probe: () => Promise.resolve({ status: 'unavailable', reason: 'Missing binary' }),
    };
    const invokedRoles: string[] = [];
    const available = fakeAdapter(async (envelope) => {
      await Promise.resolve();
      invokedRoles.push(envelope.roleId);
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
          payload: envelope.roleId === 'worker' ? validWorker : validReview,
          usage: unknownUsage,
        },
      };
    });
    const run = makeRun();
    const task = run.tasks[0];
    if (task === undefined) throw new Error('missing task');
    const result = await new OrchestrationEngine({
      adapters: new Map([
        ['codex-cli', unavailable],
        ['mock', available],
      ]),
      validate: noValidation,
      workspace: fakeWorkspace(),
    }).run({
      ...run,
      agents: [{ ...worker, transport: 'codex-cli' }, { ...worker, agentId: 'worker-2', transport: 'mock' }, reviewer],
      tasks: [{ ...task, candidateAgents: ['worker-1', 'worker-2'] }],
    });
    expect(result.state).toBe('awaiting_approval');
    expect(invokedRoles).toEqual(['worker', 'reviewer']);
  });

  it('ORCH-002 (unit) two independent tasks both start before either finishes', async () => {
    const started: string[] = [];
    const finished: string[] = [];
    let resolveTask1: () => void = () => undefined;
    const task1Gate = new Promise<void>((resolve) => {
      resolveTask1 = resolve;
    });

    const adapter = fakeAdapter(async (envelope) => {
      await Promise.resolve();
      if (envelope.roleId === 'worker') {
        if (envelope.taskId !== null) started.push(envelope.taskId);
        if (envelope.taskId === 'task-1') {
          await task1Gate;
        }
        if (envelope.taskId !== null) finished.push(envelope.taskId);
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
            payload: validWorker,
            usage: unknownUsage,
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
          usage: unknownUsage,
        },
      };
    });

    const run = makeRun();
    const task1 = run.tasks[0];
    if (task1 === undefined) throw new Error('missing task');
    const task2: OrchTask = {
      ...task1,
      id: 'task-2' as OrchTask['id'],
      allowedPaths: ['other/**'],
    };
    const multiRun: OrchRun = {
      ...run,
      tasks: [task1, task2],
      limits: {
        ...run.limits,
        maxConcurrentWorkers: 2,
      },
    };

    const engine = new OrchestrationEngine({
      adapters: new Map([['mock', adapter]]),
      validate: noValidation,
      workspace: fakeWorkspace(),
    });

    const runPromise = engine.run(multiRun);

    while (started.length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(started).toContain('task-1');
    expect(started).toContain('task-2');
    expect(finished).not.toContain('task-1');

    resolveTask1();
    const result = await runPromise;
    expect(result.state).toBe('awaiting_approval');
    expect(result.tasks.every((t) => t.state === 'completed')).toBe(true);
  });

  it('ORCH-011 (unit) cancel while two attempts run => both adapters receive abort, tasks cancelled, run cancelled', async () => {
    const abortedTasks: string[] = [];
    const startedTasks: string[] = [];

    const adapter = fakeAdapter(async (envelope, _input, signal) => {
      await Promise.resolve();
      if (envelope.roleId === 'worker') {
        if (envelope.taskId !== null) startedTasks.push(envelope.taskId);
        signal.addEventListener('abort', () => {
          if (envelope.taskId !== null) abortedTasks.push(envelope.taskId);
        });
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            resolve();
          });
        });
        return {
          ok: false,
          error: { code: 'CANCELLED', message: 'Cancelled', retryable: false },
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
          usage: unknownUsage,
        },
      };
    });

    const run = makeRun();
    const task1 = run.tasks[0];
    if (task1 === undefined) throw new Error('missing task');
    const task2: OrchTask = {
      ...task1,
      id: 'task-2' as OrchTask['id'],
      allowedPaths: ['other/**'],
    };
    const multiRun: OrchRun = {
      ...run,
      tasks: [task1, task2],
      limits: {
        ...run.limits,
        maxConcurrentWorkers: 2,
      },
    };

    const engine = new OrchestrationEngine({
      adapters: new Map([['mock', adapter]]),
      validate: noValidation,
      workspace: fakeWorkspace(),
    });

    const runPromise = engine.run(multiRun);

    while (startedTasks.length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    engine.cancel(multiRun.id);
    const result = await runPromise;

    expect(abortedTasks).toContain('task-1');
    expect(abortedTasks).toContain('task-2');
    expect(result.state).toBe('cancelled');
    expect(result.stateReason).toBe('CANCELLED');
    expect(result.tasks.every((t) => t.state === 'cancelled')).toBe(true);
  });

  it('ORCH-007 (unit) reviewer (mock) returns fix_required => task -> FIX_REQUIRED, findings stored', async () => {
    const reviewFindings = [
      {
        severity: 'error' as const,
        path: 'src/a.ts',
        message: 'Syntax error in function',
        suggestedFix: 'Fix function syntax',
      },
    ];
    const adapter = fakeAdapter(async (envelope) => {
      await Promise.resolve();
      if (envelope.roleId === 'worker') {
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
            payload: validWorker,
            usage: unknownUsage,
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
          payload: { verdict: 'fix_required', findings: reviewFindings, summary: 'Fix required' },
          usage: unknownUsage,
        },
      };
    });

    const baseRun = makeRun();
    const run = { ...baseRun, limits: { ...baseRun.limits, maxFixRounds: 0 } };

    const engine = new OrchestrationEngine({
      adapters: new Map([['mock', adapter]]),
      validate: noValidation,
      workspace: fakeWorkspace(),
    });

    const result = await engine.run(run);
    expect(result.tasks[0]?.state).toBe('fix_required');
    expect(result.tasks[0]?.stateReason).toBe('NEEDS_OWNER');
    expect(result.state).toBe('paused');
    expect(result.stateReason).toBe('NEEDS_OWNER');
  });

  it('ORCH-008 (unit) after fix_required, worker fixes, reviewer passes => new attempt id, re-review, task completed', async () => {
    let workerCalls = 0;
    let reviewerCalls = 0;
    const workerAttempts: string[] = [];
    const adapter = fakeAdapter(async (envelope) => {
      await Promise.resolve();
      if (envelope.roleId === 'worker') {
        workerCalls += 1;
        workerAttempts.push(envelope.attemptId);
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
            payload: validWorker,
            usage: unknownUsage,
          },
        };
      }
      reviewerCalls += 1;
      if (reviewerCalls === 1) {
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
            payload: {
              verdict: 'fix_required',
              findings: [
                {
                  severity: 'warning' as const,
                  path: 'a.ts',
                  message: 'fix this warning',
                  suggestedFix: 'remove unused',
                },
              ],
              summary: 'fix needed',
            },
            usage: unknownUsage,
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
          usage: unknownUsage,
        },
      };
    });

    const baseRun = makeRun();
    const run = { ...baseRun, limits: { ...baseRun.limits, maxFixRounds: 1 } };

    let idCounter = 0;
    const engine = new OrchestrationEngine({
      adapters: new Map([['mock', adapter]]),
      validate: noValidation,
      workspace: fakeWorkspace(),
      id: () => `attempt-${String(++idCounter)}`,
    });

    const result = await engine.run(run);
    expect(result.state).toBe('awaiting_approval');
    expect(result.tasks[0]?.state).toBe('completed');
    expect(workerCalls).toBe(2);
    expect(reviewerCalls).toBe(2);
    expect(workerAttempts[0]).not.toEqual(workerAttempts[1]);
  });

  it('ORCH-010 (unit) budget max cost reached / adapter unavailable => run paused with reason, no agent call started', async () => {
    const workerRun = vi.fn(async () => {
      await Promise.resolve();
      return {
        ok: true as const,
        value: {
          ack: {
            ack: true,
            roleId: 'worker' as const,
            taskId: 'task-1',
            attemptId: '1',
            allowedPaths: ['src/**'],
          },
          payload: validWorker,
          usage: unknownUsage,
        },
      };
    });
    const adapter = fakeAdapter(workerRun);

    const baseRun = makeRun();
    const run = {
      ...baseRun,
      costMicroUsd: 2_000_000 as MicroUsd,
      limits: { ...baseRun.limits, maxCostMicroUsd: 1_000_000 as MicroUsd },
    };

    const engine = new OrchestrationEngine({
      adapters: new Map([['mock', adapter]]),
      validate: noValidation,
      workspace: fakeWorkspace(),
    });

    const result = await engine.run(run);
    expect(result.state).toBe('paused');
    expect(result.stateReason).toBe('BUDGET_COST');
    expect(workerRun).not.toHaveBeenCalled();
  });

  it('ORCH-012 (unit) restart sweep sets running run to paused_interrupted and running attempt to unknown; resume creates new attempt ids', async () => {
    const attemptsStore: OrchAttempt[] = [
      {
        id: 'att-old' as OrchAttempt['id'],
        taskId: 'task-1' as OrchTask['id'],
        role: 'worker',
        agent: worker,
        state: 'running',
        changedFiles: [],
        evidence: [],
        usage: unknownUsage,
        startedAt: '2026-01-01T00:00:00.000Z' as OrchAttempt['startedAt'],
      },
    ];
    let runStore: OrchRun = {
      ...makeRun(),
      state: 'running',
    };

    const repository = {
      list: () => [runStore],
      get: () => runStore,
      attempts: () => attemptsStore,
      save: (run: OrchRun, attempts: readonly OrchAttempt[] = []) => {
        runStore = run;
        attemptsStore.length = 0;
        attemptsStore.push(...attempts);
      },
    } as unknown as OrchRepository;

    const processes = {
      upsertOrchestration: vi.fn(),
    };

    const mod = createOrchestrationModule({
      repository,
      processes,
      validate: noValidation,
      createRun: () => runStore,
      includeMock: true,
    });

    await mod.start();

    expect(runStore.state).toBe('paused_interrupted');
    expect(runStore.stateReason).toBe('INTERRUPTED');
    expect(attemptsStore[0]?.state).toBe('unknown');

    const registeredHandlers = new Map<
      string,
      (params: { runId: string }) => Promise<{ ok: boolean; value?: OrchRun }>
    >();
    const rpcServer = {
      register: (method: string, handler: (params: { runId: string }) => Promise<{ ok: boolean; value?: OrchRun }>) => {
        registeredHandlers.set(method, handler);
      },
    };
    mod.register(rpcServer as never);
    const resumeHandler = registeredHandlers.get('orch.resume');
    expect(resumeHandler).toBeDefined();

    if (resumeHandler === undefined) throw new Error('missing orch.resume handler');
    const resumed = await resumeHandler({ runId: runStore.id });
    expect(resumed.ok).toBe(true);
    expect(resumed.value?.state).toBe('awaiting_approval');
    const attempts = mod.attempts(runStore.id);
    const newAttempts = attempts.filter((a) => a.id !== 'att-old');
    expect(newAttempts.length).toBeGreaterThan(0);
  });

  it('ORCH-015 (unit) target path = IT Studio source repo / install dir => run refused TARGET_FORBIDDEN', async () => {
    const engine = new OrchestrationEngine({
      adapters: new Map([
        [
          'mock',
          fakeAdapter(async () => {
            await Promise.resolve();
            return {
              ok: true,
              value: {
                ack: {
                  ack: true,
                  roleId: 'worker',
                  taskId: '1',
                  attemptId: '1',
                  allowedPaths: [],
                },
                payload: {},
                usage: unknownUsage,
              },
            };
          }),
        ],
      ]),
      validate: { workspaceRoot: process.cwd(), allowedCommands: [] },
    });

    const run = makeRun();
    const result = await engine.run(run);
    expect(result.state).toBe('failed');
    expect(result.stateReason).toBe('TARGET_FORBIDDEN');
  });

  it('ORCH-016 (unit) run reaches the end => AWAITING_APPROVAL; no merge into target branch until approved', async () => {
    const adapter = fakeAdapter(async (envelope) => {
      await Promise.resolve();
      if (envelope.roleId === 'supervisor') {
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
            payload: { approveForOwner: true, summary: 'Approved', risks: [] },
            usage: unknownUsage,
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
          payload: envelope.roleId === 'worker' ? validWorker : validReview,
          usage: unknownUsage,
        },
      };
    });

    const engine = new OrchestrationEngine({
      adapters: new Map([['mock', adapter]]),
      validate: noValidation,
      workspace: fakeWorkspace(),
    });

    const run = makeRun();
    const result = await engine.run(run);
    expect(result.state).toBe('awaiting_approval');
  });

  it('ORCH-017 (unit) token usage unknown from an adapter => stored as null, cost null, never 0', async () => {
    const adapter = fakeAdapter(async (envelope) => {
      await Promise.resolve();
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
      };
    });

    const engine = new OrchestrationEngine({
      adapters: new Map([['mock', adapter]]),
      validate: noValidation,
      workspace: fakeWorkspace(),
    });

    const run = makeRun();
    await engine.run(run);
    const attempts = engine.attempts(run.id);
    expect(attempts.length).toBeGreaterThan(0);
    for (const attempt of attempts) {
      expect(attempt.usage.inputTokens).toBeNull();
      expect(attempt.usage.outputTokens).toBeNull();
      expect(attempt.usage.costMicroUsd).toBeNull();
      expect(attempt.usage.costMicroUsd).not.toBe(0);
    }
  });
});

describe('OrchWorkspace', () => {
  it('caches the first base SHA for all attempts in a run', async () => {
    const runner = {
      run: vi.fn(async () => {
        await Promise.resolve();
        return {
          ok: true as const,
          value: { exitCode: 0, timedOut: false, durationMs: 1, stdoutTail: 'sha-one\n', stderrTail: '' },
        };
      }),
    };
    const create = vi.fn(async (_root: string, identity: { readonly baseSha: string; readonly attempt: number }) => {
      await Promise.resolve();
      return {
        ok: true as const,
        value: { ...wt, baseSha: identity.baseSha },
      };
    });
    const workspace = new OrchWorkspace({
      projects: {
        get: async () => {
          await Promise.resolve();
          return {
            id: 'project-1' as ProjectId,
            workspaceRoot: 'C:/repo',
            name: 'Repo',
            createdAt: '2026-01-01T00:00:00.000Z' as OrchRun['createdAt'],
            archived: false,
          };
        },
      },
      worktrees: { create } as never,
      apply: {} as never,
      runner,
    });
    const run = makeRun();
    const firstTask = run.tasks[0];
    if (firstTask === undefined) throw new Error('missing task');
    await workspace.prepareAttempt(run, firstTask, 1);
    runner.run.mockResolvedValueOnce({
      ok: true,
      value: { exitCode: 0, timedOut: false, durationMs: 1, stdoutTail: 'sha-two\n', stderrTail: '' },
    });
    await workspace.prepareAttempt(run, firstTask, 2);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(create.mock.calls.map(([, identity]) => identity.baseSha)).toEqual(['sha-one', 'sha-one']);
  });
});
