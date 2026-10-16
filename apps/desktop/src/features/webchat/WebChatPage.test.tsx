import type { WebChatLayout } from '@itstudio/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';
import { WebChatPage } from './WebChatPage';
import type { IWebChatHost } from './webchat-host';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-offscreen')) return new DOMRect(1200, 200, 400, 500);
    if (this.hasAttribute('data-webchat-content')) return new DOMRect(250, 200, 400, 500);
    if (this.tagName === 'MAIN') return new DOMRect(200, 100, 700, 500);
    return new DOMRect(200, 100, 800, 600);
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function setup({ native = true, failMethod = '' } = {}) {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  const updates: WebChatLayout[] = [];
  const settings = {
    webChat: {
      browser: 'coccoc',
      customBrowserPath: null,
      links: [
        { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true },
        { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', enabled: true },
        { id: 'disabled', name: 'Disabled site', url: 'https://example.invalid/', enabled: false },
      ],
      layout: undefined as WebChatLayout | undefined,
    },
  };
  transport.send = (line) => {
    transport.sent.push(line);
    const request = JSON.parse(line) as {
      readonly id: number;
      readonly method: string;
      readonly params?: { readonly patch?: { readonly webChat?: { readonly layout?: WebChatLayout } } };
    };
    if (request.method === failMethod) {
      transport.receive(
        JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32000,
            message: 'Save failed',
            data: {
              code: 'INTERNAL',
              message: 'Layout storage failed.',
              retryable: true,
              remediation: ['Try saving the layout again.'],
            },
          },
        }),
      );
      return Promise.resolve();
    }
    let result: unknown = settings;
    if (request.method === 'settings.update') {
      const next = request.params?.patch?.webChat?.layout;
      if (next) {
        updates.push(next);
        settings.webChat.layout = next;
      }
    } else if (request.method === 'webchat.open') result = { opened: true, browser: 'coccoc' };
    else if (request.method === 'process.report') result = {};
    else if (request.method !== 'settings.get') throw new Error(`Unexpected method ${request.method}`);
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    return Promise.resolve();
  };
  const sync = vi.fn<IWebChatHost['sync']>(() => Promise.resolve());
  const reload = vi.fn<IWebChatHost['reload']>(() => Promise.resolve());
  const closeAll = vi.fn(() => Promise.resolve());
  const setVisible = vi.fn<IWebChatHost['setVisible']>(() => Promise.resolve());
  const setPaneVisible = vi.fn(() => Promise.resolve());
  const host: IWebChatHost = { available: native, sync, reload, closeAll, setVisible, setPaneVisible };
  const client = new RpcClient(transport);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (suspended: boolean, layoutRevision = '') => (
    <QueryClientProvider client={cache}>
      <RpcClientProvider client={client}>
        <main>
          <WebChatPage host={host} suspended={suspended} layoutRevision={layoutRevision} />
        </main>
      </RpcClientProvider>
    </QueryClientProvider>
  );
  const rendered = render(page(false));
  return { ...rendered, transport, updates, sync, reload, closeAll, setVisible, setPaneVisible, page };
}

describe('WebChatPage', () => {
  it('WC-03 persists free mode and restores minimized windows from the dock', async () => {
    const view = setup();
    fireEvent.change(await screen.findByRole('combobox', { name: 'Web chat layout' }), { target: { value: 'free' } });
    const minimize = await screen.findByRole('button', { name: 'Minimize ChatGPT' });
    fireEvent.click(minimize);
    expect(await screen.findByRole('button', { name: 'ChatGPT' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT' }));
    expect(await screen.findByRole('button', { name: 'Minimize ChatGPT' })).toBeVisible();
    expect(view.updates.some((layout) => layout.mode === 'free' && layout.windows?.[0]?.minimized)).toBe(true);
  });
  it('PROC-02 reports pane open/close with only lifecycle metadata', async () => {
    const view = setup();
    const reports = () =>
      view.transport.sent
        .filter((line) => line.includes('"method":"process.report"'))
        .map((line) => JSON.parse(line) as { params: { event: string; kind: string; linkId: string } });
    await waitFor(() => {
      expect(reports().some((request) => request.params.event === 'opened')).toBe(true);
    });
    expect(reports().map((request) => request.params.event)).toEqual(['opened']);
    view.unmount();
    await waitFor(() => {
      expect(reports().at(-1)?.params.event).toBe('closed');
    });
    for (const request of reports())
      expect(request.params).toEqual({
        kind: 'web_chat',
        linkId: 'chatgpt',
        event: request.params.event,
      });
    for (const request of reports()) expect(['opened', 'closed']).toContain(request.params.event);
  });
  it('PROC-02 reports reload failures without page content', async () => {
    const view = setup();
    await waitFor(() => {
      expect(view.sync).toHaveBeenCalled();
    });
    view.reload.mockRejectedValueOnce(new Error('Load failed'));
    fireEvent.click(screen.getByRole('button', { name: /Reload/ }));
    await waitFor(() => {
      expect(view.transport.sent.some((line) => line.includes('"event":"failed"'))).toBe(true);
    });
  });
  it('remeasures native pane positions when a shell banner changes layout', async () => {
    const { sync, rerender, page } = setup();
    await waitFor(() => {
      expect(sync).toHaveBeenCalled();
    });
    expect(sync.mock.lastCall?.[1][0]?.bounds.y).toBe(200);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-webchat-content')) return new DOMRect(250, 260, 400, 500);
      if (this.tagName === 'MAIN') return new DOMRect(200, 100, 700, 500);
      return new DOMRect(200, 100, 800, 600);
    });

    rerender(page(false, 'project-error'));

    await waitFor(() => {
      expect(sync.mock.lastCall?.[1][0]?.bounds.y).toBe(260);
    });
  });

  it('adds up to four panes, uses only enabled saved sites, and persists site selections', async () => {
    const { updates } = setup();
    const count = await screen.findByRole('combobox', { name: 'Panes' });
    fireEvent.change(count, { target: { value: '4' } });
    await waitFor(() => {
      expect(updates).toHaveLength(1);
    });
    expect(screen.getAllByRole('region', { name: /Web chat pane \d/ })).toHaveLength(4);
    expect(updates[0]?.sizes).toEqual([0.25, 0.25, 0.25, 0.25]);
    const site = screen.getByRole('combobox', { name: 'Site for pane 1' });
    expect(within(site).getAllByRole('option')).toHaveLength(2);
    expect(within(site).queryByRole('option', { name: 'Disabled site' })).not.toBeInTheDocument();
    fireEvent.change(site, { target: { value: 'gemini' } });
    await waitFor(() => {
      expect(updates).toHaveLength(2);
    });
    expect(updates[1]?.panes[0]).toBe('gemini');
  });

  it('resizes adjacent panes by keyboard, preserves their total, and saves the layout', async () => {
    const { updates } = setup();
    fireEvent.change(await screen.findByRole('combobox', { name: 'Panes' }), { target: { value: '2' } });
    await waitFor(() => {
      expect(updates).toHaveLength(1);
    });
    const divider = screen.getByRole('separator', { name: 'Resize panes 1 and 2' });
    divider.focus();
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(updates).toHaveLength(2);
    });
    expect(updates[1]?.sizes[0]).toBeCloseTo(0.55);
    expect(updates[1]?.sizes[1]).toBeCloseTo(0.45);
    expect(divider).toHaveAttribute('aria-valuenow', '55');
    expect(divider).toHaveAttribute('aria-valuemin', '10');
    expect(divider).toHaveAttribute('aria-valuemax', '90');
  });

  it('pauses and resumes native panes without closing them, clips bounds, and closes on unmount', async () => {
    const { sync, setVisible, closeAll, rerender, page, unmount } = setup();
    await screen.findByRole('combobox', { name: 'Panes' });
    await waitFor(() => {
      expect(sync).toHaveBeenCalled();
    });
    expect(sync.mock.calls[0]?.[1][0]?.bounds).toEqual({ x: 250, y: 200, width: 400, height: 400 });
    expect(sync.mock.calls[0]?.[2]).toEqual([0]);
    rerender(page(true));
    await waitFor(() => {
      expect(setVisible).toHaveBeenCalledWith(false);
    });
    expect(closeAll).not.toHaveBeenCalled();
    rerender(page(false));
    await waitFor(() => {
      expect(sync.mock.calls.length).toBeGreaterThan(1);
    });
    await waitFor(() => {
      expect(setVisible).toHaveBeenLastCalledWith(true);
    });
    expect(closeAll).not.toHaveBeenCalled();
    unmount();
    await waitFor(() => {
      expect(closeAll).toHaveBeenCalledOnce();
    });
  });

  it('drags a splitter with a ten-percent minimum, hides native panes during the drag, and saves on release', async () => {
    const { updates, setVisible, closeAll } = setup();
    fireEvent.change(await screen.findByRole('combobox', { name: 'Panes' }), { target: { value: '2' } });
    await waitFor(() => {
      expect(updates).toHaveLength(1);
    });
    const divider = screen.getByRole('separator', { name: 'Resize panes 1 and 2' });
    fireEvent(divider, new MouseEvent('pointerdown', { bubbles: true, clientX: 400 }));
    await waitFor(() => {
      expect(setVisible).toHaveBeenCalledWith(false);
    });
    fireEvent(window, new MouseEvent('pointermove', { clientX: 2000 }));
    expect(divider).toHaveAttribute('aria-valuenow', '90');
    expect(updates).toHaveLength(1);
    fireEvent(window, new MouseEvent('pointerup'));
    await waitFor(() => {
      expect(updates).toHaveLength(2);
    });
    expect(updates[1]?.sizes[0]).toBeCloseTo(0.9);
    expect(updates[1]?.sizes[1]).toBeCloseTo(0.1);
    await waitFor(() => {
      expect(setVisible).toHaveBeenLastCalledWith(true);
    });
    expect(closeAll).not.toHaveBeenCalled();
  });

  it('reloads through the native host and opens the selected site through the existing browser RPC', async () => {
    const { transport, reload } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: 'Open in browser' }));
    await waitFor(() => {
      expect(
        transport.sent.some((line) => line.includes('"method":"webchat.open"') && line.includes('"linkId":"chatgpt"')),
      ).toBe(true);
    });
  });

  it('retains an offscreen pane as active while omitting its invisible bounds from native sync', async () => {
    const { sync, closeAll } = setup();
    await screen.findByRole('combobox', { name: 'Panes' });
    await waitFor(() => {
      expect(sync).toHaveBeenCalled();
    });
    const content = document.querySelector('[data-webchat-content="0"]');
    content?.setAttribute('data-offscreen', 'true');
    fireEvent.scroll(screen.getByRole('main'));
    await waitFor(() => {
      expect(sync).toHaveBeenLastCalledWith(expect.any(Array), [], [0]);
    });
    expect(closeAll).not.toHaveBeenCalled();
  });

  it('makes native loading failures visible with the browser fallback', async () => {
    const { sync } = setup();
    sync.mockRejectedValueOnce(new Error('Native child unavailable'));
    expect(await screen.findByText('The embedded web chat could not be opened or updated.')).toBeVisible();
    expect(screen.getByText(/Try Open in browser/)).toBeVisible();
  });

  it('uses a desktop explanation in browser preview without creating an iframe', async () => {
    const { sync } = setup({ native: false });
    expect(await screen.findByText(/Embedded web chat is available in the desktop app/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
    expect(document.querySelector('iframe')).toBeNull();
    expect(sync).not.toHaveBeenCalled();
  });

  it('restores the previous layout and shows the RPC error when persistence fails', async () => {
    setup({ failMethod: 'settings.update' });
    const count = await screen.findByRole('combobox', { name: 'Panes' });
    fireEvent.change(count, { target: { value: '2' } });
    expect(await screen.findByText('Layout storage failed.')).toBeVisible();
    expect(count).toHaveValue('1');
    expect(screen.getAllByRole('region', { name: /Web chat pane \d/ })).toHaveLength(1);
  });

  it('dismisses the sign-in warning once across visits', async () => {
    const first = setup();
    expect(await screen.findByText(/Some providers \(especially Google accounts\)/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Some providers \(especially Google accounts\)/)).not.toBeInTheDocument();
    first.unmount();
    setup();
    await screen.findByRole('combobox', { name: 'Panes' });
    expect(screen.queryByText(/Some providers \(especially Google accounts\)/)).not.toBeInTheDocument();
  });
});
