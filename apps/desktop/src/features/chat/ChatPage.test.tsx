import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelCapability } from '@itstudio/schemas';
import type { ProjectId } from '@itstudio/schemas';
import '../../i18n';
import { ChatPage } from './ChatPage';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';
import { useNavigationIntent } from '../../state/navigation-intent';

function renderChat(withConversation = false, delaySend = false) {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  transport.send = (line) => {
    transport.sent.push(line);
    const request: unknown = JSON.parse(line);
    if (typeof request !== 'object' || request === null || !('id' in request) || !('method' in request)) {
      return Promise.resolve();
    }
    const call = request as { readonly id: number; readonly method: string };
    if (call.method === 'chat.send' && delaySend) return Promise.resolve();
    const config = {
      ladder: [],
      autoFallback: true,
      lockedModelKey: null,
      circuitBreaker: { failureThreshold: 3, cooldownMs: 120000 },
      userDecisionTimeoutMs: 120000,
    };
    const result: unknown =
      call.method === 'chat.listConversations'
        ? withConversation
          ? [
              {
                id: '00000000-0000-4000-8000-000000000002',
                projectId: '00000000-0000-4000-8000-000000000001',
                title: 'Selected workflow conversation',
                ragEnabled: false,
                createdAt: '2026-10-02T00:00:00.000Z',
                updatedAt: '2026-10-02T00:00:00.000Z',
              },
            ]
          : []
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
  afterEach(() => {
    cleanup();
    useNavigationIntent.getState().clearIntent();
  });
  it('TC-MW-009 opens a conversation selected by a workflow deep link', async () => {
    useNavigationIntent.getState().setIntent({ kind: 'conversation', id: '00000000-0000-4000-8000-000000000002' });
    renderChat(true);
    await screen.findByRole('button', { name: 'Selected workflow conversation' }, { timeout: 10000 });
    expect(
      await screen.findByRole('heading', { name: 'Selected workflow conversation' }, { timeout: 10000 }),
    ).toBeVisible();
    expect(useNavigationIntent.getState().intent).toBeNull();
  }, 20000);
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
    expect(screen.getByRole('status')).toHaveTextContent('Thinking…');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('"method":"chat.cancel"'))).toBe(true);
    });
  });

  it('replaces thinking dots with a streaming caret on first delta and removes it on completion', async () => {
    const transport = await startMessage();
    expect(screen.getByRole('status')).toHaveTextContent('Thinking…');
    notify(transport, 'chat.delta', { requestId: REQUEST_ID, textDelta: 'First answer' });
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument();
    expect(screen.getByText('First answer').closest('li')).toHaveClass('chat-streaming');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeVisible();
    notify(transport, 'chat.delta', { requestId: REQUEST_ID, textDelta: ' continued' });
    expect(screen.getByText('First answer continued')).toBeVisible();
    notify(transport, 'chat.completed', {
      requestId: REQUEST_ID,
      message: {
        id: 'answer-1',
        conversationId: CONVERSATION_ID,
        role: 'assistant',
        parts: [{ type: 'text', text: 'Final answer' }],
        createdAt: '2026-10-16T00:00:00.000Z',
      },
      cost: { microUsd: 0, vnd: 0, usdText: '$0', vndText: '0 ₫', fxAsOf: '2026-10-16T00:00:00.000Z' },
    });
    expect(screen.getByText('Final answer')).toBeVisible();
    expect(document.querySelector('.chat-streaming')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it.each([false, true])(
    'removes thinking/caret on failure (after delta: %s) and preserves remediation',
    async (delta) => {
      const transport = await startMessage();
      if (delta) notify(transport, 'chat.delta', { requestId: REQUEST_ID, textDelta: 'Partial' });
      notify(transport, 'chat.failed', {
        requestId: REQUEST_ID,
        error: {
          code: 'AUTH',
          message: 'Check your provider key',
          retryable: false,
          remediation: ['Open Settings → API Keys.', 'Save a valid key.'],
        },
      });
      expect(screen.getByRole('alert')).toHaveTextContent('Open Settings → API Keys.');
      expect(screen.getByRole('alert')).toHaveTextContent('Save a valid key.');
      expect(screen.queryByText('Thinking…')).not.toBeInTheDocument();
      expect(document.querySelector('.chat-streaming')).toBeNull();
      expect(screen.getByRole('button', { name: 'Send' })).toBeVisible();
    },
  );

  it('keeps partial text on Stop and ignores late deltas and completion', async () => {
    const transport = await startMessage();
    notify(transport, 'chat.delta', { requestId: REQUEST_ID, textDelta: 'Partial text' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByText('Partial text')).toBeVisible();
    expect(document.querySelector('.chat-streaming')).toBeNull();
    notify(transport, 'chat.delta', { requestId: REQUEST_ID, textDelta: ' late' });
    notify(transport, 'chat.completed', { requestId: REQUEST_ID, message: { parts: [] }, cost: {} });
    expect(screen.getByText('Partial text')).toBeVisible();
  });

  it('shows thinking immediately while send is pending and can stop before acknowledgment', async () => {
    const transport = await startMessage(true);
    expect(screen.getByRole('status')).toHaveTextContent('Thinking…');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument();
    const call: unknown = JSON.parse(transport.sent.find((line) => line.includes('"method":"chat.send"')) ?? '{}');
    if (typeof call !== 'object' || call === null || !('id' in call)) throw new Error('Missing send request');
    act(() => {
      transport.receive(
        JSON.stringify({ jsonrpc: '2.0', id: call.id, result: { requestId: REQUEST_ID, userMessageId: 'user-1' } }),
      );
    });
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('chat.cancel') && line.includes(REQUEST_ID))).toBe(true);
    });
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeVisible();
  });

  it('removes thinking and displays remediation when chat.send rejects', async () => {
    const transport = await startMessage(true);
    const call: unknown = JSON.parse(transport.sent.find((line) => line.includes('"method":"chat.send"')) ?? '{}');
    if (typeof call !== 'object' || call === null || !('id' in call)) throw new Error('Missing send request');
    act(() => {
      transport.receive(
        JSON.stringify({
          jsonrpc: '2.0',
          id: call.id,
          error: {
            code: -32000,
            message: 'unavailable',
            data: { code: 'INTERNAL', message: 'Unavailable', retryable: true, remediation: ['Try another model.'] },
          },
        }),
      );
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Try another model.');
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('hello');
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

const REQUEST_ID = '00000000-0000-4000-8000-000000000003';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000002';

function notify(transport: FakeTransport, method: string, params: unknown): void {
  act(() => {
    transport.receive(JSON.stringify({ jsonrpc: '2.0', method, params }));
  });
}

async function startMessage(delaySend = false): Promise<FakeTransport> {
  const transport = renderChat(false, delaySend);
  fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
  const composer = await screen.findByRole('textbox', { name: 'Message' });
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'New conversation' })).toBeVisible();
  });
  fireEvent.change(composer, { target: { value: 'hello' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByRole('button', { name: 'Stop' });
  await waitFor(() => {
    expect(transport.sent.some((line) => line.includes('"method":"chat.send"'))).toBe(true);
  });
  return transport;
}
