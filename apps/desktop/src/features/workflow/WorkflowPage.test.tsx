import type { ActivityEvent, ActivityEventId, IsoDateTime, ProjectId, WorkflowGraph } from '@itstudio/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    const isNode = target.matches('.react-flow__node');
    const width = isNode ? 240 : 1280;
    const height = isNode ? 72 : 800;
    if (isNode) {
      Object.defineProperty(target, 'offsetWidth', { configurable: true, value: width });
      Object.defineProperty(target, 'offsetHeight', { configurable: true, value: height });
    }
    const contentRect = {
      x: 0,
      y: 0,
      top: 0,
      right: width,
      bottom: height,
      left: 0,
      width,
      height,
      toJSON: () => ({}),
    };
    this.callback([{ target, contentRect } as ResizeObserverEntry], this);
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
    {
      id: 'router',
      lane: 'engine',
      labelKey: 'workflow.module.router',
      status: 'idle',
      inFlight: 0,
      calls24h: 0,
      errors24h: 0,
    },
  ],
  edges: [{ id: 'chat-router', from: 'chat', to: 'router', contract: 'LlmRequest' }],
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

function mockReducedMotion(matches: boolean): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(
      (media: string) =>
        ({
          matches,
          media,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }) satisfies MediaQueryList,
    ),
  });
  return () => {
    if (original === undefined) Reflect.deleteProperty(window, 'matchMedia');
    else Object.defineProperty(window, 'matchMedia', original);
  };
}

function edgeActivity(id: string, kind: ActivityEvent['kind'], summary: string): ActivityEvent {
  return { ...activity, id: id as ActivityEventId, edgeId: 'chat-router', kind, summary };
}

const PROJECT_A = '00000000-0000-4000-8000-000000000003' as ProjectId;
const PROJECT_B = '00000000-0000-4000-8000-000000000004' as ProjectId;

function renderSwitchableProject() {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  const requests: {
    readonly id: number;
    readonly method: string;
    readonly params: { readonly projectId: ProjectId };
  }[] = [];
  transport.send = (line) => {
    requests.push(JSON.parse(line) as (typeof requests)[number]);
    return Promise.resolve();
  };
  const client = new RpcClient(transport);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (projectId: ProjectId) => (
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider client={client}>
        <WorkflowPage projectId={projectId} projects={[]} onNavigate={() => undefined} />
      </RpcClientProvider>
    </QueryClientProvider>
  );
  const rendered = render(page(PROJECT_A));
  function respond(id: number, result: unknown): void {
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id, result }));
  }
  function projectGraph(projectId: ProjectId, calls: number): WorkflowGraph {
    return { ...graph, projectId, nodes: graph.nodes.map((node) => ({ ...node, calls24h: calls })) };
  }
  return {
    ...rendered,
    requests,
    respond,
    projectGraph,
    switchProject: (projectId: ProjectId) => {
      rendered.rerender(page(projectId));
    },
  };
}

async function renderPageWithFakeTimers(): Promise<ReturnType<typeof renderPage>> {
  vi.useFakeTimers();
  const result = renderPage();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(32);
  });
  return result;
}

describe('WorkflowPage', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the graph, opens a module panel, paginates activity, and follows deep links', async () => {
    const { routes } = renderPage();
    const graphNode = await screen.findByLabelText('Chat · Idle');
    expect(await screen.findByLabelText('Workflow minimap')).toBeInTheDocument();
    expect(await screen.findByText('LlmRequest')).toBeVisible();
    expect(within(graphNode).queryByText('Calls (24 h)')).not.toBeInTheDocument();
    expect(graphNode.querySelector('dl')).toBeNull();
    fireEvent.click(graphNode);
    fireEvent.click(await screen.findByRole('tab', { name: 'Metrics 24 h' }));
    expect(await screen.findByText('Calls (24 h): 1')).toBeVisible();
    expect(screen.getByText('Errors (24 h): 0')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Now' }));
    expect(screen.getByText('In flight: 0')).toBeVisible();
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
    expect(within(activeNode).queryByText('Calls (24 h)')).not.toBeInTheDocument();
    expect(activeNode.querySelector('dl')).toBeNull();
    fireEvent.click(activeNode);
    fireEvent.click(await screen.findByRole('tab', { name: 'Metrics 24 h' }));
    expect(await screen.findByText('Calls (24 h): 101')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Now' }));
    expect(screen.getByText('In flight: 100')).toBeVisible();
    fireEvent.click(await screen.findByRole('tab', { name: 'Recent' }));
    expect(screen.getAllByText(/^Burst event \d+$/)).toHaveLength(100);
  });

  it('renders one queued edge dot per event in a batched activity notification', async () => {
    const { transport } = await renderPageWithFakeTimers();
    expect(document.querySelector('.react-flow')).not.toBeNull();
    const callbacks: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const scheduledBefore = callbacks.length;
    const callsBefore = requestFrame.mock.calls.length;

    act(() => {
      transport.receive(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'workflow.activity',
          params: [
            edgeActivity('edge-event-1', 'started', 'First queued event'),
            edgeActivity('edge-event-2', 'progress', 'Second queued event'),
          ],
        }),
      );
    });
    expect(requestFrame).toHaveBeenCalledTimes(callsBefore + 1);
    const flushFrame = callbacks[scheduledBefore];
    if (flushFrame === undefined) throw new Error('The activity batch did not schedule an animation frame');
    act(() => {
      flushFrame(performance.now());
    });

    const dots = screen.getAllByTestId('workflow-edge-dot');
    expect(dots).toHaveLength(2);
    expect(dots.map((dot) => dot.getAttribute('data-event-id'))).toEqual(['edge-event-1', 'edge-event-2']);
    const motions = dots.map((dot) => dot.querySelector('animateMotion'));
    expect(motions).toHaveLength(2);
    expect(motions.every((motion) => motion?.getAttribute('dur') === '1200ms')).toBe(true);
    const firstMotion = motions[0];
    const secondMotion = motions[1];
    if (firstMotion === null || firstMotion === undefined || secondMotion === null || secondMotion === undefined)
      throw new Error('Each queued edge dot must contain one motion element');
    const motionPrototype = Object.getPrototypeOf(firstMotion) as object;
    const originalBeginElement = Object.getOwnPropertyDescriptor(motionPrototype, 'beginElement');
    const beginElement = vi.fn();
    Object.defineProperty(motionPrototype, 'beginElement', { configurable: true, value: beginElement });
    const startTimes = dots.map((dot) => Number(dot.getAttribute('data-start-at')));
    const firstStart = startTimes[0];
    const secondStart = startTimes[1];
    if (firstStart === undefined || secondStart === undefined) throw new Error('Each dot must expose its start time');
    expect(secondStart - firstStart).toBe(1200);

    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(beginElement).toHaveBeenCalledTimes(1);
      expect(dots[0]).toHaveStyle({ visibility: 'visible' });
      expect(dots[1]).toHaveStyle({ visibility: 'hidden' });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1250);
      });
      const remainingDot = screen.getByTestId('workflow-edge-dot');
      expect(remainingDot).toHaveAttribute('data-event-id', 'edge-event-2');
      expect(beginElement).toHaveBeenCalledTimes(2);
      expect(remainingDot).toHaveStyle({ visibility: 'visible' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1250);
      });
      expect(screen.queryByTestId('workflow-edge-dot')).not.toBeInTheDocument();
    } finally {
      if (originalBeginElement === undefined) Reflect.deleteProperty(motionPrototype, 'beginElement');
      else Object.defineProperty(motionPrototype, 'beginElement', originalBeginElement);
    }
  });

  it('highlights an active edge without a moving dot for reduced motion', async () => {
    const restoreMatchMedia = mockReducedMotion(true);
    try {
      const { transport } = await renderPageWithFakeTimers();
      expect(document.querySelector('.react-flow')).not.toBeNull();
      const callbacks: FrameRequestCallback[] = [];
      const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        callbacks.push(callback);
        return callbacks.length;
      });
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
      const scheduledBefore = callbacks.length;
      const callsBefore = requestFrame.mock.calls.length;

      act(() => {
        transport.receive(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'workflow.activity',
            params: [edgeActivity('reduced-motion-event', 'started', 'Reduced motion event')],
          }),
        );
      });
      expect(requestFrame).toHaveBeenCalledTimes(callsBefore + 1);
      const flushFrame = callbacks[scheduledBefore];
      if (flushFrame === undefined) throw new Error('The activity event did not schedule an animation frame');
      act(() => {
        flushFrame(performance.now());
      });

      expect(screen.queryByTestId('workflow-edge-dot')).not.toBeInTheDocument();
      const edgePath = document.querySelector<SVGPathElement>('.react-flow__edge-path');
      expect(edgePath).not.toBeNull();
      expect(edgePath).toHaveAttribute('style', expect.stringContaining('var(--color-primary)'));
    } finally {
      cleanup();
      restoreMatchMedia();
      vi.useRealTimers();
    }
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

  it('ignores a late graph response from the previous project after a project switch', async () => {
    const h = renderSwitchableProject();
    await waitFor(() => {
      expect(h.requests).toHaveLength(1);
    });
    const requestA = h.requests[0];
    if (!requestA) throw new Error('Project A graph was not requested');
    h.switchProject(PROJECT_B);
    await waitFor(() => {
      expect(h.requests).toHaveLength(2);
    });
    const requestB = h.requests[1];
    if (!requestB) throw new Error('Project B graph was not requested');
    await act(async () => {
      h.respond(requestB.id, h.projectGraph(PROJECT_B, 20));
      await Promise.resolve();
    });
    fireEvent.click(await screen.findByLabelText('Chat · Idle'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Metrics 24 h' }));
    expect(screen.getByText('Calls (24 h): 20')).toBeVisible();
    await act(async () => {
      h.respond(requestA.id, h.projectGraph(PROJECT_A, 10));
      await Promise.resolve();
    });
    expect(screen.getByText('Calls (24 h): 20')).toBeVisible();
    expect(screen.queryByText('Calls (24 h): 10')).not.toBeInTheDocument();
  });

  it('hides prior project history immediately and ignores late pagination after switching projects', async () => {
    const h = renderSwitchableProject();
    await waitFor(() => {
      expect(h.requests).toHaveLength(1);
    });
    const graphA = h.requests[0];
    if (!graphA) throw new Error('Project A graph was not requested');
    await act(async () => {
      h.respond(graphA.id, h.projectGraph(PROJECT_A, 10));
      await Promise.resolve();
    });
    fireEvent.click(await screen.findByLabelText('Chat · Idle'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Recent' }));
    await waitFor(() => {
      expect(h.requests).toHaveLength(2);
    });
    const historyA = h.requests[1];
    if (!historyA) throw new Error('Project A history was not requested');
    await act(async () => {
      h.respond(historyA.id, [{ ...activity, projectId: PROJECT_A, summary: 'Project A history' }]);
      await Promise.resolve();
    });
    expect(screen.getByText('Project A history')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(h.requests).toHaveLength(3);
    });
    const pageA = h.requests[2];
    if (!pageA) throw new Error('Project A history page was not requested');
    h.switchProject(PROJECT_B);
    expect(screen.queryByText('Project A history')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(
        h.requests.some((request) => request.method === 'workflow.graph' && request.params.projectId === PROJECT_B),
      ).toBe(true);
    });
    const graphB = h.requests.find(
      (request) => request.method === 'workflow.graph' && request.params.projectId === PROJECT_B,
    );
    if (!graphB) throw new Error('Project B graph was not requested');
    await act(async () => {
      h.respond(graphB.id, h.projectGraph(PROJECT_B, 20));
      await Promise.resolve();
    });
    fireEvent.click(await screen.findByRole('tab', { name: 'Recent' }));
    const historyB = h.requests.find(
      (request) => request.method === 'workflow.activity' && request.params.projectId === PROJECT_B,
    );
    if (!historyB) throw new Error('Project B history was not requested');
    await act(async () => {
      h.respond(historyB.id, [
        { ...activity, id: 'project-b-history' as ActivityEventId, projectId: PROJECT_B, summary: 'Project B history' },
      ]);
      await Promise.resolve();
    });
    expect(screen.getByText('Project B history')).toBeVisible();
    await act(async () => {
      h.respond(pageA.id, [
        {
          ...activity,
          id: 'late-project-a-page' as ActivityEventId,
          projectId: PROJECT_A,
          summary: 'Late project A history',
        },
      ]);
      await Promise.resolve();
    });
    expect(screen.queryByText('Late project A history')).not.toBeInTheDocument();
    expect(screen.getByText('Project B history')).toBeVisible();
  });
});
