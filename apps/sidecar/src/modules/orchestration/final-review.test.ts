import { describe, expect, it, vi } from 'vitest';
import type { MicroUsd, OrchAgentRef, OrchRun, ProjectId, Result } from '@itstudio/schemas';
import type { AgentEnvelope, AgentOutput, IAgentExecutionAdapter } from '../../kernel/ports/agent-execution.js';
import { OrchestrationEngine } from './engine.js';
import type { IOrchWorkspace } from './workspace.js';
import type { Worktree } from './worktrees.js';

// STAB P0-02: the supervisor's final review is a strict gate in front of AWAITING_APPROVAL.

const agents: readonly OrchAgentRef[] = [
  { agentId: 's', role: 'supervisor', transport: 'mock' },
  { agentId: 'w', role: 'worker', transport: 'mock' },
  { agentId: 'r', role: 'reviewer', transport: 'mock' },
];
const usage = {
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  reasoningTokens: null,
  source: 'unknown' as const,
  costMicroUsd: null,
  billing: 'unknown' as const,
};

function makeRun(): OrchRun {
  return {
    id: 'run-final' as OrchRun['id'],
    projectId: 'project-1' as ProjectId,
    request: 'Request',
    state: 'plan_ready',
    agents,
    tasks: [
      {
        id: 'T1' as OrchRun['tasks'][number]['id'],
        title: 'Task',
        objective: 'Do it',
        dependsOn: [],
        role: 'worker',
        candidateAgents: ['w'],
        allowedPaths: ['src/**'],
        testCommands: [],
        acceptanceCriteria: ['Done'],
        estimate: 'S',
        timeoutMs: 1000,
        state: 'ready',
        fixRounds: 0,
        attempts: [],
      },
    ],
    limits: {
      maxCostMicroUsd: 1_000_000 as MicroUsd,
      maxWallClockMs: 60_000,
      maxAgentCalls: 10,
      maxConcurrentWorkers: 1,
      maxFixRounds: 1,
      transientRetries: 0,
      hardStop: false,
    },
    targetBranch: 'main',
    costMicroUsd: 0 as MicroUsd,
    agentCalls: 0,
    createdAt: '2026-10-20T00:00:00.000Z' as OrchRun['createdAt'],
    updatedAt: '2026-10-20T00:00:00.000Z' as OrchRun['updatedAt'],
  };
}

const integration: Worktree = { path: 'C:/repo/.itstudio/orch/run-final/integration', branch: 'b', baseSha: 'base' };
function workspace(): IOrchWorkspace {
  const task: Worktree = { path: 'C:/repo/.itstudio/orch/run-final/T1-1', branch: 't', baseSha: 'base' };
  return {
    prepareAttempt: () => Promise.resolve({ ok: true as const, value: task }),
    prepareIntegration: () => Promise.resolve({ ok: true as const, value: integration }),
    mergeTask: () =>
      Promise.resolve({ ok: true as const, value: { exitCode: 0, conflict: false, headSha: 'integration-head' } }),
    validateIntegration: () => Promise.resolve({ ok: true as const, value: [] }),
    applyWorker: () =>
      Promise.resolve({
        ok: true as const,
        value: { changedFiles: ['src/a.ts'], baseSha: 'base', headSha: 'head', evidence: [] },
      }),
    diff: () => Promise.resolve({ ok: true as const, value: 'diff --git a/src/a.ts b/src/a.ts' }),
    cleanup: () => Promise.resolve({ ok: true as const, value: undefined }),
  };
}

type Supervisor = (envelope: AgentEnvelope, signal: AbortSignal) => Promise<Result<AgentOutput>>;

function ok(envelope: AgentEnvelope, payload: unknown): Result<AgentOutput> {
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
      payload,
      usage,
    },
  };
}

function engineWith(supervisor: Supervisor): OrchestrationEngine {
  const adapter: IAgentExecutionAdapter = {
    id: 'mock',
    probe: () => Promise.resolve({ status: 'available' as const }),
    capabilities: () => ({
      roles: ['supervisor', 'worker', 'reviewer'],
      structuredOutput: true,
      usage: false,
      cancel: true,
    }),
    run: async (envelope, _input, signal) => {
      await Promise.resolve();
      if (envelope.roleId === 'worker') return ok(envelope, { operations: [], summary: 'Done', assumptions: [] });
      if (envelope.roleId === 'reviewer') return ok(envelope, { verdict: 'pass', findings: [], summary: 'Pass' });
      return supervisor(envelope, signal);
    },
  };
  return new OrchestrationEngine({
    adapters: new Map([['mock', adapter]]),
    validate: { workspaceRoot: 'C:/mock-repo', allowedCommands: [] },
    workspace: workspace(),
  });
}

describe('final supervisor approval gate (STAB P0-02)', () => {
  it('P0-02 an explicit approveForOwner: true reaches AWAITING_APPROVAL with the reviewed commit', async () => {
    const engine = engineWith((envelope) =>
      Promise.resolve(ok(envelope, { approveForOwner: true, summary: 'Complete and tested.', risks: ['Check docs'] })),
    );
    const result = await engine.run(makeRun());
    expect(result.state).toBe('awaiting_approval');
    expect(result.stateReason).toBeUndefined();
    expect(result.integrationHeadSha).toBe('integration-head');
    expect(result.integrationBaseSha).toBe('base');
    const final = engine.attempts(result.id).find((attempt) => attempt.role === 'supervisor');
    expect(final?.state).toBe('succeeded');
    expect(final?.verdict).toEqual({
      verdict: 'pass',
      summary: 'Complete and tested.',
      findings: [{ severity: 'minor', path: '', message: 'Check docs', suggestedFix: '' }],
    });
  });

  it('P0-02 approveForOwner: false pauses the run and keeps the rejection reason', async () => {
    const engine = engineWith((envelope) =>
      Promise.resolve(ok(envelope, { approveForOwner: false, summary: 'Tests are missing.', risks: ['No tests'] })),
    );
    const result = await engine.run(makeRun());
    expect(result.state).toBe('paused');
    expect(result.stateReason).toBe('FINAL_REVIEW_REJECTED');
    expect(result.integrationHeadSha).toBeUndefined();
    const final = engine.attempts(result.id).find((attempt) => attempt.role === 'supervisor');
    expect(final?.verdict?.verdict).toBe('reject');
    expect(final?.verdict?.summary).toBe('Tests are missing.');
  });

  it.each([
    ['a report without approveForOwner', { summary: 'Looks fine', risks: [] }],
    ['a string instead of a boolean', { approveForOwner: 'true', summary: 'ok', risks: [] }],
    ['an empty summary', { approveForOwner: true, summary: '  ', risks: [] }],
    ['a contradictory extra verdict', { approveForOwner: true, summary: 'ok', risks: [], verdict: 'reject' }],
    ['a reviewer-style pass verdict', { verdict: 'pass', findings: [], summary: 'Pass' }],
    ['no payload at all', undefined],
  ])('P0-02 %s is invalid and never approves', async (_name, payload) => {
    const engine = engineWith((envelope) => Promise.resolve(ok(envelope, payload)));
    const result = await engine.run(makeRun());
    expect(result.state).toBe('paused');
    expect(result.stateReason).toBe('FINAL_REVIEW_INVALID');
    const final = engine.attempts(result.id).find((attempt) => attempt.role === 'supervisor');
    expect(final?.state).toBe('failed');
    expect(final?.reason).toBe('FINAL_REVIEW_INVALID');
  });

  it.each([
    ['an adapter failure', { code: 'COMMAND_FAILED', message: 'claude exited with code 1', retryable: false }],
    ['a timeout', { code: 'PROVIDER_TIMEOUT', message: 'claude did not finish in time.', retryable: true }],
  ] as const)('P0-02 %s is never treated as approval', async (_name, error) => {
    const engine = engineWith(() => Promise.resolve({ ok: false, error }));
    const result = await engine.run(makeRun());
    expect(result.state).toBe('paused');
    expect(result.stateReason).toBe('FINAL_REVIEW_FAILED');
    expect(engine.attempts(result.id).find((attempt) => attempt.role === 'supervisor')?.reason).toBe(error.code);
  });

  it('P0-02 an acknowledgement for another assignment is not an approval', async () => {
    const engine = engineWith((envelope) =>
      Promise.resolve(
        ok({ ...envelope, attemptId: 'someone-else' }, { approveForOwner: true, summary: 'ok', risks: [] }),
      ),
    );
    const result = await engine.run(makeRun());
    expect(result.state).toBe('paused');
    expect(result.stateReason).toBe('FINAL_REVIEW_FAILED');
  });

  it('P0-02 cancellation during the final review ends cancelled, not awaiting approval', async () => {
    const owner: { engine?: OrchestrationEngine } = {};
    const reviewing = vi.fn();
    const engine = engineWith(
      (envelope, signal) =>
        new Promise((resolve) => {
          reviewing();
          signal.addEventListener('abort', () => {
            resolve(ok(envelope, { approveForOwner: true, summary: 'too late', risks: [] }));
          });
          owner.engine?.cancel('run-final');
        }),
    );
    owner.engine = engine;
    const result = await engine.run(makeRun());
    expect(reviewing).toHaveBeenCalledOnce();
    expect(result.state).toBe('cancelled');
    expect(result.stateReason).toBe('CANCELLED');
    expect(result.integrationHeadSha).toBeUndefined();
  });

  it('P0-02 a run without a supervisor cannot reach the owner', async () => {
    const engine = engineWith((envelope) =>
      Promise.resolve(ok(envelope, { approveForOwner: true, summary: 'ok', risks: [] })),
    );
    const run = makeRun();
    const result = await engine.run({ ...run, agents: run.agents.filter((agent) => agent.role !== 'supervisor') });
    expect(result.state).toBe('paused');
    expect(result.stateReason).toBe('FINAL_REVIEW_UNAVAILABLE');
  });

  it('P0-02 a budget stop before the final review pauses with the budget reason', async () => {
    const supervisor = vi.fn((envelope: AgentEnvelope) =>
      Promise.resolve(ok(envelope, { approveForOwner: true, summary: 'ok', risks: [] })),
    );
    const engine = engineWith(supervisor);
    const run = makeRun();
    const result = await engine.run({ ...run, limits: { ...run.limits, maxAgentCalls: 2 } });
    expect(supervisor).not.toHaveBeenCalled();
    expect(result.state).toBe('paused');
    expect(result.stateReason).toBe('BUDGET_CALLS');
  });
});
