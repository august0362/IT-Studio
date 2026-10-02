import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RpcClient } from '../../../rpc/rpc-client';
import { RpcClientProvider } from '../../../rpc/rpc-context';
import { FakeTransport } from '../../../rpc/transport';
import '../../../i18n';
import { RouterSettingsPage } from './RouterSettingsPage';

afterEach(cleanup);

const routerConfig = {
  ladder: [
    { modelKey: 'openai/first', priority: 1, enabled: true, maxRetries: 1, timeoutMs: 30_000 },
    { modelKey: 'google/second', priority: 2, enabled: true, maxRetries: 1, timeoutMs: 30_000 },
  ],
  autoFallback: true,
  lockedModelKey: null,
  circuitBreaker: { failureThreshold: 3, cooldownMs: 120_000 },
  userDecisionTimeoutMs: 120_000,
} as const;

function setup() {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  transport.send = (line: string) => {
    transport.sent.push(line);
    const request: unknown = JSON.parse(line);
    if (typeof request !== 'object' || request === null || !('id' in request) || !('method' in request))
      return Promise.resolve();
    if (typeof request.id !== 'number' || typeof request.method !== 'string') return Promise.resolve();
    const result =
      request.method === 'router.getConfig' || request.method === 'router.updateConfig'
        ? 'params' in request &&
          typeof request.params === 'object' &&
          request.params !== null &&
          'config' in request.params
          ? request.params.config
          : routerConfig
        : request.method === 'models.list'
          ? [
              {
                key: 'openai/first',
                provider: 'openai',
                providerModelId: 'first',
                displayName: 'First',
                capabilities: [],
                contextWindowTokens: 1000,
                maxOutputTokens: 100,
                enabled: true,
              },
              {
                key: 'google/second',
                provider: 'google',
                providerModelId: 'second',
                displayName: 'Second',
                capabilities: [],
                contextWindowTokens: 1000,
                maxOutputTokens: 100,
                enabled: true,
              },
            ]
          : {};
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    return Promise.resolve();
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = new RpcClient(transport);
  render(
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider client={client}>
        <RouterSettingsPage />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
  return { transport };
}

describe('RouterSettingsPage', () => {
  it('saves Auto Fallback and renumbered keyboard reorder priorities', async () => {
    const { transport } = setup();
    const toggle = await screen.findByRole('checkbox', { name: 'Auto Fallback' });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('router.updateConfig'))).toBe(true);
    });
    const handle = screen.getByRole('button', { name: 'Reorder First' });
    fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
    fireEvent.keyDown(handle, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
    await waitFor(() => {
      const updates = transport.sent.filter((line) => line.includes('router.updateConfig'));
      const last = updates.at(-1);
      expect(last).toContain('google/second');
      expect(last).toContain('"priority":1');
    });
  });
});
