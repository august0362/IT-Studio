import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelCapability } from '@itstudio/schemas';
import type { ProjectId } from '@itstudio/schemas';
import '../../i18n';
import { ChatPage } from './ChatPage';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';

function renderChat() {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  transport.send = (line) => {
    transport.sent.push(line);
    const request: unknown = JSON.parse(line);
    if (typeof request !== 'object' || request === null || !('id' in request) || !('method' in request)) {
      return Promise.resolve();
    }
    const call = request as { readonly id: number; readonly method: string };
    const config = {
      ladder: [],
      autoFallback: true,
      lockedModelKey: null,
      circuitBreaker: { failureThreshold: 3, cooldownMs: 120000 },
      userDecisionTimeoutMs: 120000,
    };
    const result: unknown =
      call.method === 'chat.listConversations'
        ? []
        : call.method === 'chat.createConversation'
          ? {
              id: '00000000-0000-4000-8000-000000000002',
              projectId: '00000000-0000-4000-8000-000000000001',
              title: 'New conversation',
              ragEnabled: false,
              createdAt: '2026-10-02T00:00:00.000Z',
              updatedAt: '2026-10-02T00:00:00.000Z',
            }
          : call.method === 'chat.getMessages'
            ? []
            : call.method === 'chat.setRagEnabled'
              ? {
                  id: '00000000-0000-4000-8000-000000000002',
                  projectId: '00000000-0000-4000-8000-000000000001',
                  title: 'New conversation',
                  ragEnabled: true,
                  createdAt: '2026-10-02T00:00:00.000Z',
                  updatedAt: '2026-10-02T00:00:00.000Z',
                }
              : call.method === 'chat.send'
                ? {
                    requestId: '00000000-0000-4000-8000-000000000003',
                    userMessageId: '00000000-0000-4000-8000-000000000004',
                  }
                : call.method === 'router.getConfig' || call.method === 'router.updateConfig'
                  ? config
                  : call.method === 'models.list'
                    ? [
                        {
                          key: 'openai/model',
                          provider: 'openai',
                          providerModelId: 'model',
                          displayName: 'Example model',
                          capabilities: [ModelCapability.CHAT],
                          contextWindowTokens: 1000,
                          maxOutputTokens: 100,
                          enabled: true,
                        },
                      ]
                    : call.method === 'chat.cancel'
                      ? { cancelled: true }
                      : undefined;
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }));
    return Promise.resolve();
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = new RpcClient(transport);
  render(
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider client={client}>
        <ChatPage projectId={'00000000-0000-4000-8000-000000000001' as ProjectId} />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
  return transport;
}

describe('ChatPage', () => {
  afterEach(cleanup);
  it('sends and cancels with the active request id', async () => {
    const transport = renderChat();
    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    const composer = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(composer, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('"method":"chat.send"'))).toBe(true);
    });
    await screen.findByRole('button', { name: 'Stop' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('"method":"chat.cancel"'))).toBe(true);
    });
  });

  it('sets the locked model in router config', async () => {
    const transport = renderChat();
    await screen.findByRole('option', { name: 'Example model' });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'openai/model' } });
    fireEvent.click(screen.getByLabelText('Lock'));
    await waitFor(() => {
      const request = transport.sent.find((line) => line.includes('"method":"router.updateConfig"'));
      expect(request).toContain('openai/model');
    });
  });

  it('enables knowledge for the active conversation', async () => {
    const transport = renderChat();
    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Use knowledge' }));
    await waitFor(() => {
      const request = transport.sent.find((line) => line.includes('"method":"chat.setRagEnabled"'));
      expect(request).toContain('"enabled":true');
    });
  });
});
