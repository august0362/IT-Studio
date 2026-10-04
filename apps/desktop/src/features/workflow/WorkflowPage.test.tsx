import type { ActivityEvent, ActivityEventId, IsoDateTime, WorkflowGraph } from '@itstudio/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '../../i18n';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';
import { WorkflowPage } from './WorkflowPage';

class TestResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  private readonly observed = new Set<Element>();
  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  public observe(target: Element): void {
    this.observed.add(target);
    this.callback([], this);
  }
  public unobserve(target: Element): void {
    this.observed.delete(target);
  }
  public disconnect(): void {
    this.observed.clear();
    this.callback([], this);
  }
  public takeRecords(): ResizeObserverEntry[] {
    return [];
  }
}

globalThis.ResizeObserver = TestResizeObserver;
Object.defineProperty(window, 'DOMMatrixReadOnly', {
  configurable: true,
  value: class TestDOMMatrixReadOnly {
    public readonly m22 = 1;
    public readonly transform: string;
    public constructor(transform: string) {
      this.transform = transform;
    }
  },
});

const graph: WorkflowGraph = {
  projectId: null,
  generatedAt: '2026-10-04T00:00:00.000Z' as IsoDateTime,
  nodes: [
    {
      id: 'chat',
      lane: 'ui',
      labelKey: 'workflow.module.chat',
      status: 'idle',
      inFlight: 0,
      calls24h: 1,
      errors24h: 0,
    },
  ],
  edges: [],
};
const activity: ActivityEvent = {
  id: 'event-1' as ActivityEventId,
  projectId: null,
  moduleId: 'chat',
  kind: 'completed',
  summary: '1 response completed',
  refs: {},
  durationMs: 20,
  ts: '2026-10-04T00:00:00.000Z' as IsoDateTime,
};

function renderPage(): { readonly transport: FakeTransport; readonly routes: string[] } {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  const requests: { readonly id: number; readonly method: string; readonly params: unknown }[] = [];
  transport.send = (line) => {
    const request = JSON.parse(line) as { readonly id: number; readonly method: string; readonly params: unknown };
    requests.push(request);
    const result: unknown =
      request.method === 'workflow.graph' ? graph : request.method === 'workflow.activity' ? [activity] : [];
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    return Promise.resolve();
  };
  const routes: string[] = [];
  const client = new RpcClient(transport);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RpcClientProvider client={client}>
        <WorkflowPage projectId={null} projects={[]} onNavigate={(route) => routes.push(route)} />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
  return { transport, routes };
}

describe('WorkflowPage', () => {
  afterEach(cleanup);

  it('renders the graph, opens a module panel, paginates activity, and follows deep links', async () => {
    const { routes } = renderPage();
    const graphNode = await screen.findByLabelText('Chat · Idle');
    fireEvent.click(graphNode);
    fireEvent.click(await screen.findByRole('tab', { name: 'Recent' }));
    expect(await screen.findByText('1 response completed')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled());
    fireEvent.click(screen.getByRole('tab', { name: 'Deep links' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Chat' }));
    expect(routes).toEqual(['chat']);
  });

  it('opens the selected module with keyboard navigation and Enter', async () => {
    renderPage();
    await screen.findByLabelText('Chat · Idle');
    const node = document.querySelector<HTMLElement>('.react-flow__node');
    if (node === null) throw new Error('React Flow did not render a node');
    node.focus();
    fireEvent.keyDown(node, { key: 'Enter' });
    expect(await screen.findByRole('tab', { name: 'Now' })).toBeVisible();
  });
});
