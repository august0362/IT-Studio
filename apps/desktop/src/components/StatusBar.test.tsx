import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RpcClient } from '../rpc/rpc-client';
import { RpcClientProvider } from '../rpc/rpc-context';
import { FakeTransport } from '../rpc/transport';
import { connectSidecarStatus, useSidecarStatusStore } from '../state/sidecar-store';
import { StatusBar } from './StatusBar';

function renderStatusBar(transport: FakeTransport) {
  const client = new RpcClient(transport);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider client={client}>
        <StatusBar />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
}

describe('StatusBar', () => {
  it('shows connecting, ready version, restart count, and fatal log path', async () => {
    const transport = new FakeTransport();
    connectSidecarStatus(transport);
    renderStatusBar(transport);
    expect(screen.getByText('Connecting…')).toBeVisible();

    transport.receive(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'system.ready',
        params: { version: '1.2.3', recoveredTransactions: 0 },
      }),
    );
    transport.setStatus({ running: true, ready: true, restarts: 0 });
    transport.send = (line: string) => {
      const request = JSON.parse(line) as { id: number; method: string };
      transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { version: '1.2.3', uptimeMs: 10 } }));
      return Promise.resolve();
    };
    expect(await screen.findByText('Ready v1.2.3')).toBeVisible();

    act(() => {
      useSidecarStatusStore.getState().setStatus({ running: false, ready: false, restarts: 2 });
    });
    expect(screen.getByText('Restarting (2)')).toBeVisible();

    act(() => {
      useSidecarStatusStore.getState().setFatal({ message: 'stopped', logDir: 'C:/logs' });
    });
    expect(screen.getByText('Sidecar stopped: stopped. Logs: C:/logs')).toBeVisible();
  });
});
