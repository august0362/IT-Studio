import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import '../../i18n';
import { CostPage } from './CostPage';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';
import type { ProjectId } from '@itstudio/schemas';

function renderCostPage(withCost: boolean): void {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  transport.send = (line) => {
    const request = JSON.parse(line) as { readonly id: number; readonly method: string };
    const display = { microUsd: 0, vnd: 0, usdText: '$0.00', vndText: '0 ₫', fxAsOf: '2026-10-02T00:00:00.000Z' };
    const result: unknown =
      request.method === 'pnl.get'
        ? {
            projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            from: '2026-10-01T00:00:00.000Z',
            to: '2026-11-01T00:00:00.000Z',
            revenue: display,
            cost: withCost ? { ...display, microUsd: 1000, usdText: '$0.0010' } : display,
            margin: withCost ? { ...display, microUsd: -1000, usdText: '-$0.0010' } : display,
            marginPercent: null,
            byModel: [],
            byPurpose: [],
            byDay: [],
          }
        : request.method === 'budget.status' || request.method === 'revenue.listRows'
          ? []
          : request.method === 'ledger.queryRows'
            ? { items: [], nextCursor: null }
            : request.method === 'models.list' || request.method === 'project.list'
              ? []
              : undefined;
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    return Promise.resolve();
  };
  const client = new RpcClient(transport);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider client={client}>
        <CostPage projectId={'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as ProjectId} />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
}

describe('CostPage', () => {
  afterEach(cleanup);
  it('shows a negative margin with danger styling and a null margin percentage', async () => {
    renderCostPage(true);
    expect(await screen.findByText('-$0.0010')).toHaveClass('text-danger');
    expect(screen.getByText('—')).toBeInTheDocument();
  });
  it('shows the empty activity state when the project has no revenue or cost', async () => {
    renderCostPage(false);
    expect(await screen.findByText('No cost activity in this range.')).toBeInTheDocument();
  });
});
