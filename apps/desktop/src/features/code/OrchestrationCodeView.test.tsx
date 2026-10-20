import type { AppError, OrchAgentRef, OrchAttempt, OrchRun } from '@itstudio/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '../../i18n';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';
import { OrchestrationCodeView } from './OrchestrationCodeView';

const disposers: (() => void)[] = [];
afterEach(() => {
  cleanup();
  for (const dispose of disposers.splice(0)) dispose();
  void i18n.changeLanguage('en');
});

const supervisor: OrchAgentRef = { agentId: 'planner', role: 'supervisor', transport: 'claude-cli' };
const worker: OrchAgentRef = { agentId: 'coder', role: 'worker', transport: 'api', modelId: 'test-model' };
const reviewer: OrchAgentRef = { agentId: 'reviewer', role: 'reviewer', transport: 'codex-cli' };

function fixture(state: OrchRun['state'] = 'plan_ready'): OrchRun {
  return {
    // @ts-expect-error Readable fixture stands in for the branded run id.
    id: 'run-1',
    // @ts-expect-error Readable fixture stands in for the branded project id.
    projectId: 'project-1',
    request: 'Implement the greeting',
    state,
    agents: [supervisor, worker, reviewer],
    tasks: [
      {
        // @ts-expect-error Readable fixture stands in for the branded task id.
        id: 'T1',
        title: 'Add greeting',
        objective: 'Create a greeting',
        dependsOn: [],
        role: 'worker',
        candidateAgents: ['coder'],
        allowedPaths: ['src/**'],
        testCommands: [],
        acceptanceCriteria: ['Greeting exists'],
        estimate: 'S',
        timeoutMs: 60_000,
        state: 'ready',
        fixRounds: 0,
        attempts: [],
      },
    ],
    limits: {
      // @ts-expect-error Integer fixture stands in for branded microdollars.
      maxCostMicroUsd: 2_000_000,
      maxWallClockMs: 3_600_000,
      maxAgentCalls: 40,
      maxConcurrentWorkers: 2,
      maxFixRounds: 2,
      transientRetries: 1,
      hardStop: false,
    },
    targetBranch: 'main',
    // @ts-expect-error Integer fixture stands in for branded microdollars.
    costMicroUsd: 0,
    agentCalls: 0,
    // @ts-expect-error ISO fixture stands in for a branded timestamp.
    createdAt: '2026-10-20T00:00:00.000Z',
    // @ts-expect-error ISO fixture stands in for a branded timestamp.
    updatedAt: '2026-10-20T00:00:00.000Z',
  };
}

function attempt(agent: OrchAgentRef, overrides: Partial<OrchAttempt> = {}): OrchAttempt {
  return {
    // @ts-expect-error Readable fixture stands in for a branded attempt id.
    id: `attempt-${agent.role}`,
    taskId: null,
    role: agent.role,
    agent,
    state: 'succeeded',
    changedFiles: ['src/greeting.ts'],
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
    startedAt: fixture().createdAt,
    endedAt: fixture().updatedAt,
    ...overrides,
  };
}

function setup(
  run = fixture(),
  attempts: readonly OrchAttempt[] = [],
  errors: ReadonlyMap<string, AppError> = new Map(),
  hasProject = true,
) {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  transport.send = (line) => {
    transport.sent.push(line);
    const request: unknown = JSON.parse(line);
    if (typeof request !== 'object' || request === null || !('id' in request) || !('method' in request))
      return Promise.resolve();
    const error = typeof request.method === 'string' ? errors.get(request.method) : undefined;
    const results: Record<string, unknown> = {
      'orch.list': [],
      'process.list': [],
      'orch.adapters': ['api', 'claude-cli', 'codex-cli'].map((transport) => ({ transport, status: 'available' })),
      'settings.get': { orchestration: { roles: { supervisor, workerA: worker, workerB: worker, reviewer } } },
      'orch.attempts': attempts,
      'orch.plan': run,
      'orch.start': { ...run, state: 'running' },
      'orch.approve': { ...run, state: 'completed' },
    };
    transport.receive(
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        ...(error === undefined
          ? { result: typeof request.method === 'string' ? (results[request.method] ?? run) : run }
          : { error: { code: -32000, message: error.message, data: error } }),
      }),
    );
    return Promise.resolve();
  };
  const client = new RpcClient(transport);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  disposers.push(() => {
    queryClient.clear();
    client.dispose();
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider client={client}>
        <OrchestrationCodeView projectId={hasProject ? run.projectId : null} />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
  return transport;
}

async function plan(): Promise<void> {
  const request = await screen.findByRole('textbox', { name: 'Request' });
  await act(async () => Promise.resolve());
  fireEvent.change(request, { target: { value: 'Implement the greeting' } });
  fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
}

describe('OrchestrationCodeView', () => {
  it.each([
    ['orch.plan', 'plan_ready', 'Plan'],
    ['orch.start', 'plan_ready', 'Start'],
    ['orch.resume', 'paused', 'Resume'],
    ['orch.cancel', 'running', 'Cancel'],
    ['orch.approve', 'awaiting_approval', 'Approve merge'],
    ['orch.discard', 'awaiting_approval', 'Discard'],
  ] as const)('ORCH-04 displays %s remediation below the error', async (method, state, button) => {
    const error: AppError = {
      code: 'VALIDATION',
      message: 'The project needs a Git commit.',
      retryable: false,
      remediation: ['Create the first commit.', 'Then retry the run.'],
    };
    setup(fixture(state), [], new Map([[method, error]]));
    await plan();
    if (method !== 'orch.plan') fireEvent.click(await screen.findByRole('button', { name: button }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(error.message);
    expect(
      within(alert)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(error.remediation);
  });

  it('ORCH-04 shows query failures without requiring an action', async () => {
    setup(fixture(), [], new Map([['orch.list', { code: 'INTERNAL', message: 'Cannot load runs.', retryable: true }]]));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot load runs.');
    expect(screen.queryByRole('list', { name: 'Steps to resolve the error' })).not.toBeInTheDocument();
  });

  it.each(['pass', 'fix_required', 'reject'] as const)(
    'ORCH-04 renders reviewer verdict %s and every finding',
    async (verdict) => {
      setup(fixture(), [
        attempt(reviewer, {
          verdict: {
            verdict,
            summary: 'Review summary',
            findings: [
              { severity: 'major', path: 'src/a.ts', line: 12, message: 'First issue', suggestedFix: 'Add a guard.' },
              { severity: 'minor', path: 'src/b.ts', message: 'Second issue', suggestedFix: 'Rename the variable.' },
            ],
          },
        }),
      ]);
      await plan();
      expect(
        await screen.findByRole('heading', { name: `Verdict: ${i18n.t(`code.orchestrationVerdicts.${verdict}`)}` }),
      ).toBeInTheDocument();
      for (const text of [
        'Review summary',
        'Major',
        'src/a.ts:12',
        'First issue',
        'Add a guard.',
        'Minor',
        'src/b.ts',
        'Second issue',
        'Rename the variable.',
      ])
        expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
    },
  );

  it.each([supervisor, worker])('ORCH-017 shows $role details and unknown usage and cost', async (agent) => {
    setup(fixture(), [attempt(agent, { state: 'failed', reason: 'ADAPTER_UNAVAILABLE' })]);
    await plan();
    const details = (await screen.findByText(new RegExp(`${agent.agentId} ·`))).closest('article');
    expect(details).not.toBeNull();
    expect(details).toHaveTextContent(i18n.t(`settings.orchestration.transportNames.${agent.transport}`));
    expect(details).toHaveTextContent('Attempt state: Failed · Reason: ADAPTER_UNAVAILABLE');
    expect(details).toHaveTextContent('Input / output tokens: unknown / unknown · unknown');
    expect(details).toHaveTextContent('Changed files');
    expect(details).toHaveTextContent('src/greeting.ts');
    expect(details).not.toHaveTextContent('0 USD');
    expect(screen.queryByText('Verdict:', { exact: false })).not.toBeInTheDocument();
  });

  it('ORCH-017 preserves reported zero usage and cost', async () => {
    const zeroUsage: OrchAttempt['usage'] = {
      ...attempt(worker).usage,
      inputTokens: 0,
      outputTokens: 0,
      // @ts-expect-error Zero fixture stands in for branded microdollars.
      costMicroUsd: 0,
    };
    setup(fixture(), [attempt(worker, { usage: zeroUsage })]);
    await plan();
    expect(await screen.findByText(/Input \/ output tokens: 0 \/ 0 · 0 USD/)).toBeInTheDocument();
  });

  it('ORCH-019 plans, starts, receives live updates and approves', async () => {
    const transport = setup();
    await plan();
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeEnabled();
    const run = fixture('awaiting_approval');
    act(() => {
      transport.receive(JSON.stringify({ jsonrpc: '2.0', method: 'orch.event', params: { type: 'run', run } }));
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve merge' }));
    expect(await screen.findByRole('heading', { name: 'Run: Completed' })).toBeInTheDocument();
    for (const method of ['orch.plan', 'orch.start', 'orch.approve'])
      expect(transport.sent.some((line) => line.includes(method))).toBe(true);
  });

  it('ORCH-04 disables planning until a project is selected', () => {
    setup(fixture(), [], new Map(), false);
    expect(screen.getByRole('button', { name: 'Plan' })).toBeDisabled();
    expect(screen.getByText('Choose a project to plan an orchestration run.')).toBeInTheDocument();
  });
});
