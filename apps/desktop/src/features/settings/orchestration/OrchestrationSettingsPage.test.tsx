import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '../../../i18n';
import { RpcClient } from '../../../rpc/rpc-client';
import { RpcClientProvider } from '../../../rpc/rpc-context';
import { FakeTransport } from '../../../rpc/transport';
import { OrchestrationSettingsPage } from './OrchestrationSettingsPage';

afterEach(() => {
  cleanup();
  void i18n.changeLanguage('en');
});

describe('ORCH-018 orchestration settings', () => {
  it('rejects invalid values inline and confirms a valid save', async () => {
    const orchestration = {
      roles: {
        supervisor: {
          agentId: 'supervisor',
          role: 'supervisor',
          transport: 'api',
          providerId: 'anthropic',
          modelId: 'claude',
        },
        workerA: { agentId: 'worker-a', role: 'worker', transport: 'api', providerId: 'openai', modelId: 'gpt' },
        workerB: { agentId: 'worker-b', role: 'worker', transport: 'api', providerId: 'openai', modelId: 'gpt' },
        reviewer: { agentId: 'reviewer', role: 'reviewer', transport: 'api', providerId: 'openai', modelId: 'gpt' },
      },
      limits: {
        maxCostMicroUsd: 2_000_000,
        maxWallClockMs: 3_600_000,
        maxAgentCalls: 40,
        maxConcurrentWorkers: 2,
        maxFixRounds: 2,
        transientRetries: 1,
        hardStop: false,
      },
    };
    const settings = { orchestration };
    const transport = new FakeTransport();
    transport.setStatus({ running: true, ready: true, restarts: 0 });
    transport.send = (line) => {
      transport.sent.push(line);
      const request: unknown = JSON.parse(line);
      if (typeof request !== 'object' || request === null || !('id' in request) || !('method' in request))
        return Promise.resolve();
      const result =
        request.method === 'orch.adapters'
          ? [{ transport: 'api', status: 'available' }]
          : request.method === 'models.list'
            ? []
            : settings;
      transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
      return Promise.resolve();
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RpcClientProvider client={new RpcClient(transport)}>
          <OrchestrationSettingsPage />
        </RpcClientProvider>
      </QueryClientProvider>,
    );
    const concurrency = await screen.findByRole('spinbutton', { name: 'Concurrent workers' });
    fireEvent.change(concurrency, { target: { value: '5' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid value');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(concurrency, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(transport.sent.some((line) => line.includes('settings.update'))).toBe(true);
  });
});
