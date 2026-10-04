import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import '../../../i18n';
import { WebChatSettingsPage } from './WebChatSettingsPage';
import { RpcClient } from '../../../rpc/rpc-client';
import { RpcClientProvider } from '../../../rpc/rpc-context';
import { FakeTransport } from '../../../rpc/transport';

afterEach(cleanup);

function renderPage(rejectUpdate = false) {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  const saved: string[] = [];
  const settings = {
    webChat: {
      browser: 'default',
      customBrowserPath: null,
      links: [
        { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true },
        { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', enabled: true },
      ],
    },
  };
  transport.send = (line) => {
    transport.sent.push(line);
    const request = JSON.parse(line) as {
      readonly id: number;
      readonly method: string;
      readonly params: { readonly patch?: unknown };
    };
    let result: unknown;
    if (request.method === 'settings.get' || request.method === 'settings.update') {
      result = settings;
      if (request.method === 'settings.update') {
        saved.push(JSON.stringify(request.params.patch));
        if (rejectUpdate) {
          transport.receive(
            JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              error: {
                code: -32000,
                message: 'validation failed',
                data: {
                  code: 'VALIDATION',
                  message: 'Settings patch failed validation',
                  details: { issues: [{ path: 'webChat.links.0.url', message: 'Use a valid HTTPS URL.' }] },
                  remediation: ['Review the setting values and try again.'],
                  retryable: false,
                },
              },
            }),
          );
          return Promise.resolve();
        }
      }
    } else if (request.method === 'webchat.browsers')
      result = [
        { browser: 'default', installed: true, path: null },
        { browser: 'coccoc', installed: false, path: null },
        { browser: 'chrome', installed: false, path: null },
        { browser: 'edge', installed: false, path: null },
        { browser: 'firefox', installed: false, path: null },
        { browser: 'custom', installed: false, path: null },
      ];
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    return Promise.resolve();
  };
  const client = new RpcClient(transport);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RpcClientProvider client={client}>
        <WebChatSettingsPage />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
  return { transport, saved };
}

describe('WebChatSettingsPage', () => {
  it('reorders links, resets to defaults, and saves via settings.update', async () => {
    const { transport, saved } = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Move down ChatGPT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save web chat settings' }));
    await waitFor(() => {
      expect(saved.length).toBe(1);
    });
    expect(saved[0]).toContain('gemini');
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save web chat settings' }));
    await waitFor(() => {
      expect(saved.length).toBe(2);
    });
    expect(saved[1]).toContain('perplexity');
    expect(transport.sent.filter((line) => line.includes('settings.update'))).toHaveLength(2);
  });

  it('shows unavailable browsers as disabled options and supports custom executable paths', async () => {
    renderPage();
    const chrome = await screen.findByRole('option', { name: 'Chrome (not installed)' });
    expect(chrome).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Browser'), { target: { value: 'custom' } });
    expect(await screen.findByLabelText('Browser .exe path')).toBeVisible();
  });

  it('adds and deletes links', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add link' }));
    expect(screen.getAllByRole('row')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Delete ChatGPT' }));
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('shows sidecar URL validation details beside the affected field', async () => {
    renderPage(true);
    const urlInputs = await screen.findAllByLabelText('URL');
    const urlInput = urlInputs[0];
    if (urlInput === undefined) throw new Error('Expected a web chat URL input');
    fireEvent.change(urlInput, { target: { value: 'http://chatgpt.com/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save web chat settings' }));
    expect(await screen.findByText('Use a valid HTTPS URL.')).toBeVisible();
  });
});
