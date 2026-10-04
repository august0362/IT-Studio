import type { ActivityEvent, ActivityEventId, IsoDateTime, WorkflowGraph } from '@itstudio/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  refs: {
    conversationId: '00000000-0000-4000-8000-000000000002' as NonNullable<ActivityEvent['refs']['conversationId']>,
  },
  durationMs: 20,
  ts: '2026-10-04T00:00:00.000Z' as IsoDateTime,
};

function renderPage(): {
  readonly transport: FakeTransport;
  readonly routes: string[];
  readonly navigations: { readonly route: string; readonly event?: ActivityEvent }[];
} {
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
  const navigations: { readonly route: string; readonly event?: ActivityEvent }[] = [];
  const client = new RpcClient(transport);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RpcClientProvider client={client}>
        <WorkflowPage
          projectId={null}
          projects={[]}
          onNavigate={(route, event) => {
            routes.push(route);
            navigations.push({ route, ...(event === undefined ? {} : { event }) });
          }}
        />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
  return { transport, routes, navigations };
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

  it('TC-MW-008 coalesces a 100-event notification burst into one animation-frame update', async () => {
    const { transport } = renderPage();
    await screen.findByLabelText('Chat · Idle');
    const callbacks: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const scheduledBefore = callbacks.length;
    const callsBefore = requestFrame.mock.calls.length;
    const burst = Array.from({ length: 100 }, (_, index): ActivityEvent => ({
      ...activity,
      id: `burst-${String(index)}` as ActivityEventId,
      kind: 'started',
      summary: `Burst event ${String(index)}`,
      refs: {},
    }));

    act(() => {
      transport.receive(JSON.stringify({ jsonrpc: '2.0', method: 'workflow.activity', params: burst }));
    });

    expect(requestFrame).toHaveBeenCalledTimes(callsBefore + 1);
    expect(callbacks).toHaveLength(scheduledBefore + 1);
    const flushFrame = callbacks[scheduledBefore];
    if (flushFrame === undefined) throw new Error('The activity burst did not schedule a frame callback');
    act(() => {
      flushFrame(performance.now());
    });

    const activeNode = await screen.findByLabelText('Chat · Active');
    const counts = activeNode.querySelectorAll('dd');
    expect(counts[0]?.textContent).toBe('100');
    expect(counts[1]?.textContent).toBe('101');
    fireEvent.click(activeNode);
    fireEvent.click(await screen.findByRole('tab', { name: 'Recent' }));
    expect(screen.getAllByText(/^Burst event \d+$/)).toHaveLength(100);
  });

  it('TC-MW-009 forwards the selected activity references through its deep link', async () => {
    const { navigations } = renderPage();
    fireEvent.click(await screen.findByLabelText('Chat · Idle'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Recent' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open related area' }));

    expect(navigations).toHaveLength(1);
    expect(navigations[0]).toMatchObject({
      route: 'chat',
      event: { refs: { conversationId: activity.refs.conversationId } },
    });
  });
});
