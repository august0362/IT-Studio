import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@itstudio/schemas';
import { useNotification } from '../hooks/use-notification';
import { useRpcMutation } from '../hooks/use-rpc-mutation';
import { useRpcQuery } from '../hooks/use-rpc-query';
import { RpcCallError, RpcClient } from './rpc-client';
import { RpcClientProvider } from './rpc-context';
import { FakeTransport, TauriTransport } from './transport';
import type { RpcMethod } from '@itstudio/schemas';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

function ready(transport: FakeTransport): void {
  transport.setStatus({ running: true, ready: true, restarts: 0 });
}

function response(transport: FakeTransport, id: number, result: unknown): void {
  transport.receive(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

function testWrapper(client: RpcClient, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <RpcClientProvider client={client}>{children}</RpcClientProvider>
      </QueryClientProvider>
    );
  };
}

describe('RpcClient', () => {
  it('correlates out-of-order responses and type-checks method parameters', async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    ready(transport);

    const invalidParams = (): void => {
      // @ts-expect-error settings.get accepts only an empty parameter object
      client.call('settings.get', { name: 'wrong' }).catch(() => undefined);
    };
    expect(invalidParams).toBeTypeOf('function');

    const first = client.call('system.ping', {});
    const second = client.call('project.list', {});
    const sent = transport.sent.map((line) => JSON.parse(line) as { id: number; method: RpcMethod });
    expect(sent.map(({ id, method }) => [id, method])).toEqual([[1, 'system.ping'], [2, 'project.list']]);
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: 2, result: [] }));
    response(transport, 1, { version: '1.0.0', uptimeMs: 42 });
    await expect(second).resolves.toEqual([]);
    await expect(first).resolves.toEqual({ version: '1.0.0', uptimeMs: 42 });
    client.dispose();
  });

  it('maps sidecar errors from error.data', async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    ready(transport);
    const pending = client.call('settings.get', {});
    transport.receive(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32000, message: 'failed', data: { code: ErrorCode.NOT_FOUND, message: 'missing', retryable: false } },
    }));
    await expect(pending).rejects.toMatchObject({
      appError: { code: ErrorCode.NOT_FOUND, message: 'missing' },
    });
    client.dispose();
  });

  it('rejects timed out and aborted calls with synthetic errors', async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    ready(transport);
    await expect(client.call('settings.get', {}, { timeoutMs: 5 })).rejects.toMatchObject({
      appError: { code: ErrorCode.INTERNAL, message: 'request timed out' },
    });
    const controller = new AbortController();
    const cancelled = client.call('settings.get', {}, { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ appError: { code: ErrorCode.CANCELLED } });
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(client.call('settings.get', {}, { signal: alreadyAborted.signal })).rejects.toMatchObject({
      appError: { code: ErrorCode.CANCELLED },
    });
    client.dispose();
  });

  it('rejects all calls after a sidecar restart', async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    ready(transport);
    const pending = client.call('settings.get', {});
    transport.setStatus({ running: false, ready: false, restarts: 0 });
    await expect(pending).rejects.toMatchObject({ appError: { code: ErrorCode.INTERNAL, message: 'sidecar restarted' } });
    client.dispose();
  });

  it('queues calls until ready and rejects overflow', async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    const queued = Array.from({ length: 101 }, () => client.call('settings.get', {}).catch((error: unknown) => error));
    const overflow = await queued[100];
    expect(overflow).toBeInstanceOf(RpcCallError);
    expect((overflow as RpcCallError).appError.message).toBe('sidecar request queue is full');
    expect(transport.sent).toHaveLength(0);

    ready(transport);
    expect(transport.sent).toHaveLength(100);
    for (let id = 1; id <= 100; id += 1) response(transport, id, {});
    await Promise.all(queued.slice(0, 100));
    client.dispose();
  });

  it('dispatches notifications and stops dispatching after unsubscribe', () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    const handler = vi.fn();
    const unsubscribe = client.on('chat.delta', handler);
    transport.receive(JSON.stringify({ jsonrpc: '2.0', method: 'chat.delta', params: { requestId: 'r1', textDelta: 'hi' } }));
    unsubscribe();
    transport.receive(JSON.stringify({ jsonrpc: '2.0', method: 'chat.delta', params: { requestId: 'r1', textDelta: 'again' } }));
    expect(handler).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it('ignores malformed input, opens on system.ready, and handles RPC protocol errors', async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    const queued = client.call('settings.get', {});
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    transport.receive('{broken');
    expect(warning).toHaveBeenCalledOnce();
    transport.receive(JSON.stringify({
      jsonrpc: '2.0',
      method: 'system.ready',
      params: { version: '1.0.0', recoveredTransactions: 0 },
    }));
    expect(transport.sent).toHaveLength(1);
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'bad request' } }));
    await expect(queued).rejects.toMatchObject({
      appError: { code: ErrorCode.INTERNAL, message: 'bad request' },
    });
    warning.mockRestore();
    client.dispose();
  });

  it('rejects pending calls when the restart counter advances', async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    ready(transport);
    const pending = client.call('settings.get', {});
    transport.setStatus({ running: true, ready: false, restarts: 1 });
    await expect(pending).rejects.toMatchObject({
      appError: { code: ErrorCode.INTERNAL, message: 'sidecar restarted' },
    });
    client.dispose();
  });

  it('renders query data and subscribes and cleans up React notifications', async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    ready(transport);
    const wrapper = testWrapper(client);
    const query = renderHook(() => useRpcQuery('system.ping', {}), { wrapper });
    await waitFor(() => {
      expect(transport.sent).toHaveLength(1);
    });
    act(() => {
      response(transport, 1, { version: '2.0.0', uptimeMs: 100 });
    });
    await waitFor(() => {
      expect(query.result.current.data).toEqual({ version: '2.0.0', uptimeMs: 100 });
    });

    const handler = vi.fn();
    const notification = renderHook(() => {
      useNotification('chat.delta', handler);
    }, { wrapper });
    act(() => {
      transport.receive(JSON.stringify({
        jsonrpc: '2.0', method: 'chat.delta', params: { requestId: 'r2', textDelta: 'hello' },
      }));
    });
    expect(handler).toHaveBeenCalledTimes(1);
    notification.unmount();
    act(() => {
      transport.receive(JSON.stringify({
        jsonrpc: '2.0', method: 'chat.delta', params: { requestId: 'r2', textDelta: 'ignored' },
      }));
    });
    expect(handler).toHaveBeenCalledTimes(1);
    query.unmount();
    client.dispose();
  });

  it('runs RPC mutations with method-specific parameters', async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    ready(transport);
    const wrapper = testWrapper(client);
    const mutation = renderHook(() => useRpcMutation('project.create'), { wrapper });
    let result: unknown;
    await act(async () => {
      const promise = mutation.result.current.mutateAsync({ name: 'Demo', workspaceRoot: 'C:/demo' });
      await waitFor(() => {
        expect(transport.sent).toHaveLength(1);
      });
      response(transport, 1, { id: 'project-1', name: 'Demo', workspaceRoot: 'C:/demo', createdAt: 'now' });
      result = await promise;
    });
    expect(result).toMatchObject({ name: 'Demo', workspaceRoot: 'C:/demo' });
    client.dispose();
  });
});

describe('TauriTransport', () => {
  it('invokes the sidecar commands and unwraps event payloads', async () => {
    const unlisten = vi.fn();
    const eventCallbacks = new Map<string, (event: { payload: unknown }) => void>();
    invokeMock.mockResolvedValue({ running: true, ready: true, restarts: 0 });
    listenMock.mockImplementation((eventName: string, callback: (event: { payload: unknown }) => void) => {
      eventCallbacks.set(eventName, callback);
      return Promise.resolve(unlisten);
    });
    const transport = new TauriTransport();
    await transport.send('{"jsonrpc":"2.0"}');
    await expect(transport.status()).resolves.toEqual({ running: true, ready: true, restarts: 0 });
    const onMessage = vi.fn();
    const onStatus = vi.fn();
    const onFatal = vi.fn();
    const stop = transport.onMessage(onMessage);
    const stopStatus = transport.onStatus(onStatus);
    const stopFatal = transport.onFatal(onFatal);
    await Promise.resolve();
    eventCallbacks.get('sidecar://message')?.({ payload: 'rpc line' });
    eventCallbacks.get('sidecar://status')?.({ payload: { running: true, ready: false, restarts: 1 } });
    eventCallbacks.get('sidecar://fatal')?.({ payload: { message: 'stopped', logDir: 'logs' } });
    expect(onMessage).toHaveBeenCalledWith('rpc line');
    expect(onStatus).toHaveBeenCalledWith({ running: true, ready: false, restarts: 1 });
    expect(onFatal).toHaveBeenCalledWith({ message: 'stopped', logDir: 'logs' });
    stop();
    stopStatus();
    stopFatal();
    expect(unlisten).toHaveBeenCalledTimes(3);
    expect(invokeMock).toHaveBeenCalledWith('sidecar_send', { line: '{"jsonrpc":"2.0"}' });
    expect(invokeMock).toHaveBeenCalledWith('sidecar_status');
    eventCallbacks.clear();
    invokeMock.mockReset();
    listenMock.mockReset();
  });
});
