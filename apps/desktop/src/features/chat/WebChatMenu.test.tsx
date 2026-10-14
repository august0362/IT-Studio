import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectId } from '@itstudio/schemas';
import '../../i18n';
import { WebChatMenu } from './WebChatMenu';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';

afterEach(cleanup);

function renderMenu() {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  transport.send = (line) => {
    transport.sent.push(line);
    const request = JSON.parse(line) as { readonly id: number; readonly method: string };
    const result =
      request.method === 'settings.get'
        ? { webChat: { links: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true }] } }
        : request.method === 'webchat.open'
          ? { opened: true, browser: 'coccoc' }
          : request.method === 'webchat.projectBrief'
            ? { text: 'Project\nMy question: ' }
            : undefined;
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    return Promise.resolve();
  };
  const client = new RpcClient(transport);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RpcClientProvider client={client}>
        <WebChatMenu onEdit={() => undefined} projectId={'00000000-0000-4000-8000-000000000001' as ProjectId} />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
  return transport;
}

describe('WebChatMenu', () => {
  it('opens from the keyboard and opens a saved link with a browser toast', async () => {
    const transport = renderMenu();
    const trigger = await screen.findByRole('button', { name: 'Web chat' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /ChatGPT/ }));
    await screen.findByRole('status');
    expect(screen.getByRole('status')).toHaveTextContent('Opened in Cốc Cốc');
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('webchat.open'))).toBe(true);
    });
  });

  it('copies the project brief to the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const transport = renderMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Web chat' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy project brief' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('Project\nMy question: ');
    });
    expect(transport.sent.some((line) => line.includes('webchat.projectBrief'))).toBe(true);
  });
});
