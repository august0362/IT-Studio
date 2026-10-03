import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RpcClient } from '../../../rpc/rpc-client';
import { RpcClientProvider } from '../../../rpc/rpc-context';
import { FakeTransport } from '../../../rpc/transport';
import '../../../i18n';
import { PricingSettingsPage } from './PricingSettingsPage';

afterEach(cleanup);

function setup() {
  const transport = new FakeTransport();
  const client = new RpcClient(transport);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  transport.receive(
    JSON.stringify({ jsonrpc: '2.0', method: 'system.ready', params: { version: '0.1.0', recoveredTransactions: 0 } }),
  );
  let overridden = true;
  let getRowsCalls = 0;
  transport.send = (line: string) => {
    transport.sent.push(line);
    const request = JSON.parse(line) as { readonly id: number; readonly method: string };
    let result: unknown;
    if (request.method === 'models.list') {
      result = [];
    } else if (request.method === 'pricing.getRows') {
      getRowsCalls += 1;
      result = {
        table: {
          version: 'manual-test',
          effectiveFrom: '2026-10-01T00:00:00.000Z',
          origin: overridden ? 'manual_override' : 'seed',
          entries: [
            {
              modelKey: 'openai/test-model',
              inputPerMTokMicroUsd: 100,
              outputPerMTokMicroUsd: 200,
              cachedInputPerMTokMicroUsd: 50,
              freeTier: false,
              sourceUrl: 'https://example.invalid/pricing',
            },
          ],
        },
        rows: [
          {
            entry: {
              modelKey: 'openai/test-model',
              inputPerMTokMicroUsd: 100,
              outputPerMTokMicroUsd: 200,
              cachedInputPerMTokMicroUsd: 50,
              freeTier: false,
              sourceUrl: 'https://example.invalid/pricing',
            },
            input: { microUsd: 100, vnd: 1, usdText: '$0.0001', vndText: '1 ₫' },
            output: { microUsd: 200, vnd: 1, usdText: '$0.0002', vndText: '1 ₫' },
            cachedInput: { microUsd: 50, vnd: 1, usdText: '$0.00005', vndText: '1 ₫' },
            overridden,
          },
        ],
        stale: false,
      };
    } else if (request.method === 'pricing.clearOverride') {
      overridden = false;
      result = {
        version: 'manual-cleared',
        effectiveFrom: '2026-10-02T00:00:00.000Z',
        origin: 'manual_override',
        entries: [],
      };
    } else {
      throw new Error(`Unexpected RPC method: ${request.method}`);
    }
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    return Promise.resolve();
  };
  render(
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider client={client}>
        <PricingSettingsPage projectActive />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
  return { transport, getRowsCalls: () => getRowsCalls };
}

describe('PricingSettingsPage', () => {
  it('clears a confirmed manual override and refreshes the price rows', async () => {
    const { transport, getRowsCalls } = setup();
    const row = await screen.findByRole('row', { name: /test-model/ });
    expect(within(row).getByText('Overridden')).toBeVisible();

    fireEvent.click(within(row).getByRole('button', { name: 'Clear override' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Clear manual price override?' });
    expect(dialog).toHaveTextContent('Restore the automatic or seed price for openai/test-model?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear override' }));

    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('"method":"pricing.clearOverride"'))).toBe(true);
      expect(getRowsCalls()).toBeGreaterThan(1);
    });
    expect(screen.queryByText('Overridden')).not.toBeInTheDocument();
  });
});
