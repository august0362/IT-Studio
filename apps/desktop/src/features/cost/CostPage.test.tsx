import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import '../../i18n';
import { CostPage } from './CostPage';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';
import type { ProjectId } from '@itstudio/schemas';
import { getDateRange, parseCustomDateRange } from './date-range';

interface CostRequest {
  readonly method: string;
  readonly params: unknown;
}

function renderCostPage(withCost: boolean): CostRequest[] {
  const transport = new FakeTransport();
  const requests: CostRequest[] = [];
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  transport.send = (line) => {
    const request = JSON.parse(line) as { readonly id: number; readonly method: string; readonly params: unknown };
    requests.push({ method: request.method, params: request.params });
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
  return requests;
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

  it('TC-M9-015 keeps Cost mounted through incomplete and reversed dates, then queries a valid same-day range', async () => {
    const requests = renderCostPage(false);
    expect(await screen.findByText('No cost activity in this range.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'custom' } });
    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    fireEvent.change(from, { target: { value: '2026-10-12' } });
    expect(screen.getByRole('heading', { name: 'Cost & P&L' })).toBeInTheDocument();
    fireEvent.change(to, { target: { value: '2026-10-10' } });
    expect(screen.getByRole('heading', { name: 'Cost & P&L' })).toBeInTheDocument();
    fireEvent.change(from, { target: { value: '2026-10-10' } });
    await waitFor(() => {
      expect(requests.filter((request) => request.method === 'pnl.get').at(-1)?.params).toEqual({
        projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        from: '2026-10-10T00:00:00.000Z',
        to: '2026-10-11T00:00:00.000Z',
      });
    });
    fireEvent.change(from, { target: { value: '2026-10-12' } });
    await waitFor(() => {
      expect(requests.filter((request) => request.method === 'pnl.get').at(-1)?.params).toEqual({
        projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        ...getDateRange('today'),
      });
    });
    fireEvent.change(to, { target: { value: '' } });
    expect(screen.getByRole('heading', { name: 'Cost & P&L' })).toBeInTheDocument();
  });
});

describe('parseCustomDateRange', () => {
  it('TC-M9-015 includes a valid same-day selection as a full UTC day', () => {
    expect(parseCustomDateRange('2026-10-10', '2026-10-10')).toEqual({
      from: '2026-10-10T00:00:00.000Z',
      to: '2026-10-11T00:00:00.000Z',
    });
  });

  it.each([
    ['', '2026-10-10'],
    ['2026-10-', '2026-10-10'],
    ['2026-10-10', ''],
    ['2026-10-10', '2026-10-'],
    ['2026-02-30', '2026-10-10'],
    ['2026-10-10', '2026-13-01'],
    ['2026-10-10', '9999-12-31'],
  ])('TC-M9-015 returns no range for incomplete or impossible dates %s to %s', (from, to) => {
    expect(parseCustomDateRange(from, to)).toBeUndefined();
  });

  it('TC-M9-015 hands reversed input to the existing custom fallback', () => {
    const now = new Date('2026-10-11T12:00:00.000Z');
    const reversed = parseCustomDateRange('2026-10-12', '2026-10-10');
    expect(getDateRange('custom', now, reversed)).toEqual(getDateRange('today', now));
  });
});
