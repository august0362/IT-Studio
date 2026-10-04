import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import type { LedgerEntry, LedgerRow, ProjectId } from '@itstudio/schemas';
import '../../i18n';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';
import { LedgerTable } from './LedgerTable';

afterEach(cleanup);

describe('LedgerTable deep links', () => {
  it('filters the ledger to the request referenced by a workflow event', () => {
    const projectId = '00000000-0000-4000-8000-000000000001' as ProjectId;
    const requestId = '00000000-0000-4000-8000-000000000002';
    const entry: LedgerEntry = {
      id: '00000000-0000-4000-8000-000000000003' as LedgerEntry['id'],
      projectId,
      occurredAt: '2026-10-02T00:00:00.000Z' as LedgerEntry['occurredAt'],
      purpose: 'chat',
      modelKey: 'openai/test-model',
      llmRequestId: requestId as NonNullable<LedgerEntry['llmRequestId']>,
      usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
      costMicroUsd: 5 as LedgerEntry['costMicroUsd'],
      priceTableVersion: 'test' as LedgerEntry['priceTableVersion'],
      billedFailure: false,
    };
    const entryWithoutRequest: LedgerEntry = {
      id: '00000000-0000-4000-8000-000000000004' as LedgerEntry['id'],
      projectId,
      occurredAt: entry.occurredAt,
      purpose: entry.purpose,
      modelKey: entry.modelKey,
      usage: entry.usage,
      costMicroUsd: entry.costMicroUsd,
      priceTableVersion: entry.priceTableVersion,
      billedFailure: false,
    };
    const cost = {
      microUsd: 5,
      vnd: 1,
      usdText: '$0.000005',
      vndText: '1 ₫',
      fxAsOf: entry.occurredAt,
    } as LedgerRow['cost'];
    const other: LedgerRow = {
      entry: entryWithoutRequest,
      cost,
    };
    const selected: LedgerRow = {
      entry,
      cost,
    };
    const transport = new FakeTransport();
    transport.setStatus({ running: true, ready: true, restarts: 0 });
    const client = new RpcClient(transport);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RpcClientProvider client={client}>
          <LedgerTable
            from={entry.occurredAt}
            initial={{ items: [other, selected], nextCursor: null }}
            projectId={projectId}
            selectedEntryId={requestId}
            selectedField="requestId"
            to={entry.occurredAt}
          />
        </RpcClientProvider>
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getAllByRole('row')[1]).toHaveAttribute('aria-current', 'true');
  });
});
