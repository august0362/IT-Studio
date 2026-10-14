import { WebChatBrowser } from '@itstudio/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '../../i18n';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';
import { ResolvedWebChatSettingsPage } from './ResolvedWebChatSettingsPage';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderPage(initialBrowser: WebChatBrowser, coccocInstalled: boolean) {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  const updates: unknown[] = [];
  const settings = {
    webChat: {
      browser: initialBrowser,
      customBrowserPath: null,
      links: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true }],
    },
  };

  transport.send = (line) => {
    const request = JSON.parse(line) as {
      readonly id: number;
      readonly method: string;
      readonly params?: { readonly patch?: unknown };
    };
    let result: unknown = {};
    if (request.method === 'settings.get') {
      result = settings;
    } else if (request.method === 'settings.update') {
      const patch = request.params?.patch;
      updates.push(patch);
      const update = patch as { readonly webChat?: { readonly browser?: WebChatBrowser } } | undefined;
      if (update?.webChat?.browser !== undefined) settings.webChat.browser = update.webChat.browser;
      result = settings;
    } else if (request.method === 'webchat.browsers') {
      result = [
        { browser: WebChatBrowser.DEFAULT, installed: true, path: null },
        {
          browser: WebChatBrowser.COCCOC,
          installed: coccocInstalled,
          path: coccocInstalled ? 'C:\\Fake\\CocCoc\\browser.exe' : null,
        },
        { browser: WebChatBrowser.CHROME, installed: false, path: null },
        { browser: WebChatBrowser.EDGE, installed: false, path: null },
        { browser: WebChatBrowser.FIREFOX, installed: false, path: null },
        { browser: WebChatBrowser.CUSTOM, installed: false, path: null },
      ];
    }
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    return Promise.resolve();
  };

  const client = new RpcClient(transport);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RpcClientProvider client={client}>
        <ResolvedWebChatSettingsPage />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
  return { updates };
}

describe('ResolvedWebChatSettingsPage browser default', () => {
  it('selects and persists Cốc Cốc once when it is installed and the setting is system default', async () => {
    const { updates } = renderPage(WebChatBrowser.DEFAULT, true);

    await waitFor(() => {
      expect(updates).toEqual([{ webChat: { browser: WebChatBrowser.COCCOC } }]);
    });
    expect(await screen.findByLabelText('Browser')).toHaveValue(WebChatBrowser.COCCOC);
    expect(updates).toHaveLength(1);
  });

  it('keeps system default without persisting when Cốc Cốc is not installed', async () => {
    const { updates } = renderPage(WebChatBrowser.DEFAULT, false);

    expect(await screen.findByLabelText('Browser')).toHaveValue(WebChatBrowser.DEFAULT);
    expect(updates).toHaveLength(0);
  });

  it('does not overwrite an explicit browser preference', async () => {
    const { updates } = renderPage(WebChatBrowser.CHROME, true);

    expect(await screen.findByLabelText('Browser')).toHaveValue(WebChatBrowser.CHROME);
    expect(updates).toHaveLength(0);
  });
});
