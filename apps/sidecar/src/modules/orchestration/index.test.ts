import { describe, expect, it, vi } from 'vitest';
import type {
  MicroUsd,
  OrchAgentRef,
  OrchAttempt,
  OrchestrationSettings,
  OrchRun,
  OrchTaskSpec,
  ProjectId,
  Result,
} from '@itstudio/schemas';
import type { AgentEnvelope, IAgentExecutionAdapter } from '../../kernel/ports/agent-execution.js';
import { createOrchestrationModule, normalizeCandidates, settingsWorkers, type RunCreationOptions } from './index.js';
import type { IOrchWorkspace } from './workspace.js';
import type { OrchRepository } from './storage/orch-repository.js';

const supervisor: OrchAgentRef = { agentId: 'supervisor:claude-cli', role: 'supervisor', transport: 'claude-cli' };
const workerA: OrchAgentRef = {
  agentId: 'workerA:openrouter/deepseek',
  role: 'worker',
  transport: 'api',
  providerId: 'openrouter',
  modelId: 'deepseek/deepseek-v4-flash',
};
const workerB: OrchAgentRef = { agentId: 'workerB:codex-cli', role: 'worker', transport: 'codex-cli' };
const reviewer: OrchAgentRef = { agentId: 'reviewer:codex-cli', role: 'reviewer', transport: 'codex-cli' };
const settings: OrchestrationSettings = {
  roles: { supervisor, workerA, workerB, reviewer },
  limits: {
    maxCostMicroUsd: 500_000 as MicroUsd,
    maxWallClockMs: 1_800_000,
    maxAgentCalls: 12,
    maxConcurrentWorkers: 1,
    maxFixRounds: 1,
    transientRetries: 0,
    hardStop: true,
  },
};
const usage = {
  inputTokens: 100,
  outputTokens: 50,
  cachedInputTokens: null,
  reasoningTokens: null,
  source: 'cli' as const,
  costMicroUsd: null,
  billing: 'subscription' as const,
};
const planTask = {
  id: 'T1',
  title: 'Add greet',
  objective: 'Add a greet function',
  dependsOn: [],
  role: 'worker',
  candidateAgents: ['someone-unknown'],
  allowedPaths: ['src/**'],
  testCommands: [],
  acceptanceCriteria: ['greet returns a greeting'],
  estimate: 'S',
  timeoutMs: 300_000,
};

function supervisorAdapter(payload: unknown, seen: AgentEnvelope[]): IAgentExecutionAdapter {
  return {
    id: 'claude-cli',
    probe: () => Promise.resolve({ status: 'available' }),
    capabilities: () => ({ roles: ['supervisor'], structuredOutput: true, usage: true, cancel: true }),
    run: (envelope) => {
      seen.push(envelope);
      return Promise.resolve({
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
      });
    },
  };
}

function setup(payload: unknown, projectRoot = 'C:/projects/sample') {
  const seen: AgentEnvelope[] = [];
  const saved: { run: OrchRun; attempts: readonly OrchAttempt[] }[] = [];
  const repository = {
    save: (run: OrchRun, attempts: readonly OrchAttempt[] = []) => {
      saved.push({ run, attempts });
    },
    get: () => undefined,
    list: () => [],
    attempts: () => [],
  } as unknown as OrchRepository;
  const unused = () => Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: 'unused', retryable: false } });
  const workspace: IOrchWorkspace = {
    prepareAttempt: unused,
    prepareIntegration: unused,
    mergeTask: unused,
    validateIntegration: unused,
    applyWorker: unused,
    diff: unused,
    cleanup: unused,
    projectInfo: () =>
      Promise.resolve({
        ok: true,
        value: { root: projectRoot, branch: 'develop', tree: ['src/index.ts', 'README.md'] },
      }),
  } as IOrchWorkspace;
  const createRun = vi.fn(
    (projectId: ProjectId, request: string, tasks: readonly OrchTaskSpec[], options?: RunCreationOptions): OrchRun => ({
      id: (options?.id ?? 'run') as OrchRun['id'],
      projectId,
      request,
      state: 'plan_ready',
      agents: options?.agents ?? [],
      tasks: tasks.map((task) => ({ ...task, state: 'ready' as const, fixRounds: 0, attempts: [] })),
      limits: options?.limits ?? settings.limits,
      targetBranch: options?.targetBranch ?? 'main',
      costMicroUsd: 0 as MicroUsd,
      agentCalls: 0,
      createdAt: '2026-10-20T00:00:00.000Z' as OrchRun['createdAt'],
      updatedAt: '2026-10-20T00:00:00.000Z' as OrchRun['updatedAt'],
    }),
  );
  const handlers = new Map<string, (params: unknown) => Promise<Result<OrchRun>>>();
  const mod = createOrchestrationModule({
    repository,
    processes: { upsertOrchestration: vi.fn() },
    validate: { workspaceRoot: 'C:/data', allowedCommands: [] },
    createRun,
    adapters: [supervisorAdapter(payload, seen)],
    workspace,
    sidecarCwd: 'C:/itstudio',
    settings: () => Promise.resolve({ ok: true, value: { orchestration: settings, allowedCommands: [] } }),
  });
  mod.register({
    register: (method: string, handler: (params: unknown) => Promise<Result<OrchRun>>) => {
      handlers.set(method, handler);
    },
  } as never);
  const plan = handlers.get('orch.plan');
  if (plan === undefined) throw new Error('orch.plan not registered');
  return { plan, seen, saved, createRun };
}

describe('orchestration module with real agents', () => {
  it('plans with the configured supervisor and creates the run from the owner settings', async () => {
    const { plan, seen, saved } = setup({ tasks: [planTask] });
    const result = await plan({ projectId: 'project-1', request: 'Add a greet function' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen[0]).toMatchObject({ roleId: 'supervisor', transportId: 'claude-cli', taskId: null });
    expect(result.value.agents).toEqual([supervisor, workerA, workerB, reviewer]);
    expect(result.value.limits).toEqual(settings.limits);
    expect(result.value.targetBranch).toBe('develop');
    expect(result.value.agentCalls).toBe(1);
    // Unknown candidate ids fall back to every configured worker.
    expect(result.value.tasks[0]?.candidateAgents).toEqual([workerA.agentId, workerB.agentId]);
    expect(saved[0]?.attempts).toHaveLength(1);
    expect(saved[0]?.attempts[0]).toMatchObject({ role: 'supervisor', state: 'succeeded', taskId: null, usage });
    expect(saved[0]?.run.id).toBe(result.value.id);
  });

  it('returns PLAN_INVALID with details and stores nothing when the supervisor plan is invalid', async () => {
    const { plan, saved, createRun } = setup({ tasks: [{ ...planTask, dependsOn: ['T9'] }] });
    const result = await plan({ projectId: 'project-1', request: 'x' });
    expect(result).toMatchObject({ ok: false, error: { code: 'PLAN_INVALID' } });
    expect(createRun).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it('refuses to plan for a project inside IT Studio itself', async () => {
    const { plan, seen } = setup({ tasks: [planTask] }, 'C:/itstudio/apps');
    expect(await plan({ projectId: 'project-1', request: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'TARGET_FORBIDDEN' },
    });
    expect(seen).toHaveLength(0);
  });

  it('derives distinct workers and keeps only known candidate agents', () => {
    expect(settingsWorkers({ ...settings, roles: { ...settings.roles, workerB: workerA } })).toEqual([workerA]);
    const [task] = normalizeCandidates([{ ...planTask, candidateAgents: [workerB.agentId, 'ghost'] }] as never, [
      workerA,
      workerB,
    ]);
    expect(task?.candidateAgents).toEqual([workerB.agentId]);
  });
});
