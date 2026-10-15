import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JSX, ReactNode } from 'react';
import type { ProjectId } from '@itstudio/schemas';
import '../i18n';
import { RpcClient } from '../rpc/rpc-client';
import { RpcClientProvider } from '../rpc/rpc-context';
import { FakeTransport } from '../rpc/transport';
import { ChatPage } from './chat/ChatPage';
import { ApiKeysPage } from './settings/api-keys/ApiKeysPage';
import { RevenueForm } from './cost/RevenueForm';
import { CodePage } from './code/CodePage';
import { WorkflowPage } from './workflow/WorkflowPage';
import { CostPage } from './cost/CostPage';

vi.mock('@monaco-editor/react', () => ({
  loader: { config: () => undefined },
  Editor: ({ value }: { readonly value?: string }) => <div data-testid="monaco-editor">{value}</div>,
  default: () => <div data-testid="monaco-editor" />,
}));

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as ProjectId;
const otherProjectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as ProjectId;
const conversationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const at = '2026-10-02T00:00:00.000Z';

afterEach(cleanup);

interface FixtureOptions {
  readonly hold?: ReadonlySet<string>;
  readonly pending?: { readonly line: string; readonly resolve: (result: unknown) => void }[];
  readonly respond?: (method: string, params: Record<string, unknown>) => unknown;
}

function fixture(options: FixtureOptions = {}) {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  transport.receive(
    JSON.stringify({ jsonrpc: '2.0', method: 'system.ready', params: { version: '0.1.0', recoveredTransactions: 0 } }),
  );
  transport.send = (line) => {
    transport.sent.push(line);
    const request = JSON.parse(line) as {
      readonly id: number;
      readonly method: string;
      readonly params: Record<string, unknown>;
    };
    const zero = { microUsd: 0, vnd: 0, usdText: '$0.00', vndText: '0 ₫', fxAsOf: at };
    const responses: Record<string, unknown> = {
      'project.list': [],
      'settings.get': { webChat: { links: [] } },
      'chat.listConversations': [],
      'chat.createConversation': {
        id: conversationId,
        projectId,
        title: 'Test conversation',
        ragEnabled: false,
        createdAt: at,
        updatedAt: at,
        roleAssignment: { pm: [], coder: [], reviewer: [] },
        fixAttempts: 0,
      },
      'chat.getMessages': [],
      'chat.setRagEnabled': {
        id: conversationId,
        projectId,
        title: 'Test conversation',
        ragEnabled: false,
        createdAt: at,
        updatedAt: at,
      },
      'chat.send': {
        requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        userMessageId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      },
      'chat.cancel': { cancelled: true },
      'router.getConfig': {
        ladder: [],
        autoFallback: true,
        lockedModelKey: null,
        circuitBreaker: { failureThreshold: 3, cooldownMs: 120000 },
        userDecisionTimeoutMs: 120000,
      },
      'router.updateConfig': {
        ladder: [],
        autoFallback: true,
        lockedModelKey: null,
        circuitBreaker: { failureThreshold: 3, cooldownMs: 120000 },
        userDecisionTimeoutMs: 120000,
      },
      'models.list': [],
      'pipeline.list': [],
      'pipeline.start': {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        projectId,
        stage: 'specifying',
        prompt: 'test',
        startedAt: at,
        updatedAt: at,
        coderOutputs: [],
        verdicts: [],
        validation: [],
        events: [],
        cost: { microUsd: 0, vnd: 0, usdText: '$0.00', vndText: '0 ₫', fxAsOf: at },
      },
      'secrets.status': [],
      'secrets.history': [],
      'secrets.verifyAndSave': { provider: request.params.provider, configured: true, hint: '1234' },
      'secrets.delete': { deleted: true },
      'revenue.add': {
        entry: {
          id: '11111111-1111-4111-8111-111111111111',
          projectId,
          occurredAt: at,
          amountMicroUsd: 1000000,
          enteredCurrency: 'USD',
          description: 'Revenue',
        },
        amount: zero,
      },
      'pnl.get': {
        projectId,
        from: at,
        to: at,
        revenue: zero,
        cost: zero,
        margin: zero,
        marginPercent: null,
        byModel: [],
        byPurpose: [],
        byDay: [],
      },
      'ledger.queryRows': { items: [], nextCursor: null },
      'revenue.listRows': [],
      'budget.status': [],
    };
    if (options.hold?.has(request.method)) {
      options.pending?.push({
        line,
        resolve: (result) => {
          transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
        },
      });
      return Promise.resolve();
    }
    const result = options.respond?.(request.method, request.params) ?? responses[request.method];
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    return Promise.resolve();
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  const wrap = (children: ReactNode): JSX.Element => (
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider client={new RpcClient(transport)}>{children}</RpcClientProvider>
    </QueryClientProvider>
  );
  return { transport, wrap };
}

function requestCount(transport: FakeTransport, method: string): number {
  return transport.sent.filter((line) => line.includes(`"method":"${method}"`)).length;
}

function renderCostRacePage(): void {
  const { wrap } = fixture();
  render(wrap(<CostPage projectId={projectId} />));
}

describe('QA-BREAK-02 UI races', () => {
  it('BRK-U01 deduplicates Send while the first RPC is pending', async () => {
    const pending: { line: string; resolve: (result: unknown) => void }[] = [];
    const testFixture = fixture({ hold: new Set(['chat.send']), pending });
    render(testFixture.wrap(<ChatPage projectId={projectId} />));
    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    const message = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(message, { target: { value: 'send race' } });
    const send = screen.getByRole('button', { name: 'Send' });
    fireEvent.click(send);
    fireEvent.click(send);
    fireEvent.keyDown(message, { key: 'Enter', code: 'Enter', charCode: 13 });
    await waitFor(() => {
      expect(requestCount(testFixture.transport, 'chat.send')).toBeGreaterThan(0);
    });
    expect(requestCount(testFixture.transport, 'chat.send')).toBe(1);
    pending[0]?.resolve({
      requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      userMessageId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    });
  });

  it('BRK-U01 deduplicates Save key while verification is pending', async () => {
    const pending: { line: string; resolve: (result: unknown) => void }[] = [];
    const testFixture = fixture({ hold: new Set(['secrets.verifyAndSave']), pending });
    render(testFixture.wrap(<ApiKeysPage />));
    const input = await screen.findByLabelText('Anthropic API key');
    fireEvent.change(input, { target: { value: 'candidate-key-1234' } });
    const save = screen.getAllByRole('button', { name: 'Verify & save' })[0];
    if (!(save instanceof HTMLButtonElement)) throw new Error('Save key button was not rendered');
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
    await waitFor(() => {
      expect(requestCount(testFixture.transport, 'secrets.verifyAndSave')).toBeGreaterThan(0);
    });
    expect(requestCount(testFixture.transport, 'secrets.verifyAndSave')).toBe(1);
    pending[0]?.resolve({ provider: 'anthropic', configured: true, hint: '1234' });
  });

  it('BRK-U01 deduplicates Start pipeline while the first RPC is pending', async () => {
    const pending: { line: string; resolve: (result: unknown) => void }[] = [];
    const testFixture = fixture({ hold: new Set(['pipeline.start']), pending });
    render(testFixture.wrap(<CodePage projectId={projectId} />));
    fireEvent.change(await screen.findByLabelText('What should we build?'), { target: { value: 'start race' } });
    const start = screen.getByRole('button', { name: 'Run pipeline' });
    fireEvent.click(start);
    fireEvent.click(start);
    await waitFor(() => {
      expect(requestCount(testFixture.transport, 'pipeline.start')).toBeGreaterThan(0);
    });
    expect(requestCount(testFixture.transport, 'pipeline.start')).toBe(1);
    pending[0]?.resolve({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      projectId,
      stage: 'specifying',
      prompt: 'test',
      startedAt: at,
      updatedAt: at,
      coderOutputs: [],
      verdicts: [],
      validation: [],
      events: [],
      cost: { microUsd: 0, vnd: 0, usdText: '$0.00', vndText: '0 ₫', fxAsOf: at },
    });
  });

  it('QA-BREAK-02-D01 BRK-U01 deduplicates Add revenue while the first RPC is pending', async () => {
    const pending: { line: string; resolve: (result: unknown) => void }[] = [];
    const testFixture = fixture({ hold: new Set(['revenue.add']), pending });
    render(testFixture.wrap(<RevenueForm projectId={projectId} rows={[]} onAdded={() => undefined} />));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'race' } });
    const add = screen.getByRole('button', { name: 'Add revenue' });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.keyDown(screen.getByLabelText('Description'), { key: 'Enter', code: 'Enter', charCode: 13 });
    await waitFor(() => {
      expect(requestCount(testFixture.transport, 'revenue.add')).toBeGreaterThan(0);
    });
    expect(requestCount(testFixture.transport, 'revenue.add')).toBe(1);
    pending[0]?.resolve({
      entry: {
        id: '11111111-1111-4111-8111-111111111111',
        projectId,
        occurredAt: at,
        amountMicroUsd: 1_000_000,
        enteredCurrency: 'USD',
        description: 'Revenue',
      },
      amount: { microUsd: 0, vnd: 0, usdText: '$0.00', vndText: '0 ₫', fxAsOf: at },
    });
  });

  it('BRK-U02 ignores late chat, pipeline, and workflow responses after switching projects', async () => {
    const pending: { line: string; resolve: (result: unknown) => void }[] = [];
    const testFixture = fixture({ hold: new Set(['chat.listConversations']), pending });
    const { rerender } = render(testFixture.wrap(<ChatPage projectId={projectId} />));
    await waitFor(() => {
      expect(pending.length).toBeGreaterThan(0);
    });
    rerender(testFixture.wrap(<ChatPage projectId={otherProjectId} />));
    await waitFor(() => {
      expect(pending.length).toBeGreaterThan(1);
    });
    const oldResponse = pending[0];
    oldResponse?.resolve([
      { id: conversationId, projectId, title: 'Old project response', ragEnabled: false, createdAt: at, updatedAt: at },
    ]);
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Old project response' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();

    cleanup();
    const pipelinePending: { line: string; resolve: (result: unknown) => void }[] = [];
    const pipelineFixture = fixture({ hold: new Set(['pipeline.list']), pending: pipelinePending });
    const pipelineView = render(pipelineFixture.wrap(<CodePage projectId={projectId} />));
    await waitFor(() => {
      expect(pipelinePending.length).toBeGreaterThan(0);
    });
    pipelineView.rerender(pipelineFixture.wrap(<CodePage projectId={otherProjectId} />));
    await waitFor(() => {
      expect(pipelinePending.length).toBeGreaterThan(1);
    });
    pipelinePending[0]?.resolve([
      {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        projectId,
        prompt: 'old project pipeline run',
        stage: 'failed',
        roleAssignment: { pm: [], coder: [], reviewer: [] },
        coderOutputs: [],
        verdicts: [],
        fixAttempts: 0,
        cost: { microUsd: 0, vnd: 0, usdText: '$0.00', vndText: '0 ₫', fxAsOf: at },
        startedAt: at,
      },
    ]);
    await waitFor(() => {
      expect(screen.queryByText(/old project pipeline run/u)).not.toBeInTheDocument();
    });

    cleanup();
    const workflowPending: { line: string; resolve: (result: unknown) => void }[] = [];
    const workflowFixture = fixture({ hold: new Set(['workflow.graph']), pending: workflowPending });
    const workflowView = render(
      workflowFixture.wrap(
        <WorkflowPage
          projectId={projectId}
          projects={[]}
          onNavigate={() => {
            expect(true).toBe(true);
          }}
        />,
      ),
    );
    await waitFor(() => {
      expect(workflowPending.length).toBeGreaterThan(0);
    });
    workflowView.rerender(
      workflowFixture.wrap(
        <WorkflowPage
          projectId={otherProjectId}
          projects={[]}
          onNavigate={() => {
            expect(true).toBe(true);
          }}
        />,
      ),
    );
    await waitFor(() => {
      expect(workflowPending.length).toBeGreaterThan(1);
    });
    workflowPending[0]?.resolve({ projectId, nodes: [], edges: [], generatedAt: at });
    expect(workflowView.container).toBeInTheDocument();
  });

  it('QA-BREAK-02-D02 BRK-U02 clears the selected conversation when switching from project A to B', async () => {
    const oldConversation = {
      id: conversationId,
      projectId,
      title: 'Project A conversation',
      ragEnabled: false,
      createdAt: at,
      updatedAt: at,
    };
    const testFixture = fixture({
      respond: (method, params) =>
        method === 'chat.listConversations' && params.projectId === projectId ? [oldConversation] : undefined,
    });
    const view = render(testFixture.wrap(<ChatPage projectId={projectId} />));
    fireEvent.click(await screen.findByRole('button', { name: 'Project A conversation' }));
    const message = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(message, { target: { value: 'must not target project A chat' } });
    expect(screen.getByRole('heading', { name: 'Project A conversation' })).toBeInTheDocument();
    view.rerender(testFixture.wrap(<ChatPage projectId={otherProjectId} />));
    await waitFor(() => {
      expect(screen.queryByText('Project A conversation')).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    });
    expect(requestCount(testFixture.transport, 'chat.send')).toBe(0);
  });

  it('QA-BREAK-02-D03 BRK-U02 clears a selected project A pipeline run after switching to project B', async () => {
    const oldRun = {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      projectId,
      prompt: 'Project A secret run',
      stage: 'failed',
      roleAssignment: { pm: [], coder: [], reviewer: [] },
      coderOutputs: [],
      verdicts: [],
      fixAttempts: 0,
      cost: { microUsd: 0, vnd: 0, usdText: '$0.00', vndText: '0 ₫', fxAsOf: at },
      startedAt: at,
    };
    const testFixture = fixture({
      respond: (method, params) =>
        method === 'pipeline.list' && params.projectId === projectId ? [oldRun] : undefined,
    });
    const view = render(testFixture.wrap(<CodePage projectId={projectId} />));
    fireEvent.click(await screen.findByRole('button', { name: /Project A secret run/u }));
    await waitFor(() => {
      expect(requestCount(testFixture.transport, 'pipeline.get')).toBeGreaterThan(0);
    });
    view.rerender(testFixture.wrap(<CodePage projectId={otherProjectId} />));
    await waitFor(() => expect(screen.queryByText('Project A secret run')).not.toBeInTheDocument());
  });

  it('QA-BREAK-02-D04 BRK-U02 ignores stale pipeline.get results that resolve after a newer result', async () => {
    const pending: { line: string; resolve: (result: unknown) => void }[] = [];
    const testFixture = fixture({
      hold: new Set(['pipeline.get']),
      pending,
      respond: (method) =>
        method === 'pipeline.list'
          ? [
              {
                id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
                projectId,
                prompt: 'same run',
                stage: 'failed',
                roleAssignment: { pm: [], coder: [], reviewer: [] },
                coderOutputs: [],
                verdicts: [],
                fixAttempts: 0,
                cost: { microUsd: 0, vnd: 0, usdText: '$0.00', vndText: '0 ₫', fxAsOf: at },
                startedAt: at,
              },
            ]
          : undefined,
    });
    render(testFixture.wrap(<CodePage projectId={projectId} />));
    const runButton = await screen.findByRole('button', { name: /same run/u });
    fireEvent.click(runButton);
    fireEvent.click(runButton);
    await waitFor(() => {
      expect(pending.length).toBeGreaterThan(1);
    });
    const completed = {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      projectId,
      prompt: 'same run',
      stage: 'completed',
      roleAssignment: { pm: [], coder: [], reviewer: [] },
      coderOutputs: [],
      verdicts: [],
      fixAttempts: 0,
      cost: { microUsd: 0, vnd: 0, usdText: '$0.00', vndText: '0 ₫', fxAsOf: at },
      startedAt: at,
    };
    pending.at(-1)?.resolve(completed);
    pending[0]?.resolve({ ...completed, stage: 'writing' });
    await waitFor(() => expect(screen.getByText(/completed/iu)).toBeInTheDocument());
  });

  it('BRK-U03 keeps a form draft and the app mounted through Disconnected to Ready', async () => {
    const testFixture = fixture();
    render(testFixture.wrap(<ApiKeysPage />));
    const input = await screen.findByLabelText('Anthropic API key');
    fireEvent.change(input, { target: { value: 'draft-key-1234' } });
    testFixture.transport.setStatus({ running: false, ready: false, restarts: 1 });
    testFixture.transport.setStatus({ running: true, ready: true, restarts: 1 });
    expect(input).toHaveValue('draft-key-1234');
    expect(screen.getByRole('heading', { name: 'API keys' })).toBeInTheDocument();
  });

  it('BRK-U04 keeps CostPage mounted for every date prefix and 200 invalid or reversed ranges', async () => {
    renderCostRacePage();
    expect(await screen.findByRole('heading', { name: 'Cost & P&L' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'custom' } });
    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    const date = '2026-10-14';
    for (let index = 1; index <= date.length; index += 1) {
      fireEvent.change(from, { target: { value: date.slice(0, index) } });
      expect(screen.getByRole('heading', { name: 'Cost & P&L' })).toBeInTheDocument();
    }
    let seed = 0x02b02;
    const randomText = (): string => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return `2026-${String(seed % 15).padStart(2, '0')}-${String((seed >>> 8) % 40).padStart(2, '0')}`;
    };
    for (let index = 0; index < 200; index += 1) {
      fireEvent.change(from, { target: { value: randomText() } });
      fireEvent.change(to, { target: { value: randomText() } });
      expect(screen.getByRole('heading', { name: 'Cost & P&L' })).toBeInTheDocument();
    }
  });
});
