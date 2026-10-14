import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RpcClient } from '../../../rpc/rpc-client';
import { RpcClientProvider } from '../../../rpc/rpc-context';
import { FakeTransport } from '../../../rpc/transport';
import '../../../i18n';
import { PricingSettingsPage } from './PricingSettingsPage';

afterEach(cleanup);

function setup({ seedRemaining = false, noKeys = false, failMethod = '' } = {}) {
  const transport = new FakeTransport();
  const client = new RpcClient(transport);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  transport.receive(
    JSON.stringify({ jsonrpc: '2.0', method: 'system.ready', params: { version: '0.1.0', recoveredTransactions: 0 } }),
  );
  let overridden = true;
  let getRowsCalls = 0;
  let selectedModelKey = noKeys ? null : 'openai/test-model';
  transport.send = (line: string) => {
    transport.sent.push(line);
    const request = JSON.parse(line) as {
      readonly id: number;
      readonly method: string;
      readonly params?: { readonly patch?: { readonly pricing?: { readonly extractionModelKey?: string } } };
    };
    if (request.method === failMethod) {
      transport.receive(
        JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32000,
            message: 'Request failed',
            data: {
              code: 'PROVIDER_AUTH',
              message: 'Extraction key was rejected.',
              retryable: false,
              remediation: ['Replace the API key and try again.'],
            },
          },
        }),
      );
      return Promise.resolve();
    }
    let result: unknown;
    if (request.method === 'models.list') {
      result = [
        { key: 'openai/test-model', displayName: 'Eligible OpenAI' },
        { key: 'google/eligible', displayName: 'Eligible Google' },
        { key: 'xai/no-key', displayName: 'Chat without a key' },
        { key: 'openai/embedding', displayName: 'Embedding only' },
        { key: 'openai/disabled', displayName: 'Disabled chat' },
      ];
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
            origin: overridden ? 'manual_override' : 'seed',
          },
          ...(seedRemaining
            ? [
                {
                  entry: {
                    modelKey: 'xai/no-key',
                    inputPerMTokMicroUsd: 100,
                    outputPerMTokMicroUsd: 200,
                    cachedInputPerMTokMicroUsd: 50,
                    freeTier: false,
                    sourceUrl: 'https://example.invalid/seed',
                    origin: 'seed',
                  },
                  input: { microUsd: 100, vnd: 1, usdText: '$0.0001', vndText: '1 ₫' },
                  output: { microUsd: 200, vnd: 1, usdText: '$0.0002', vndText: '1 ₫' },
                  cachedInput: { microUsd: 50, vnd: 1, usdText: '$0.00005', vndText: '1 ₫' },
                  overridden: false,
                  origin: 'seed',
                },
              ]
            : []),
        ],
        stale: false,
        extraction: {
          selectedModelKey,
          options: noKeys
            ? []
            : [
                {
                  modelKey: 'openai/test-model',
                  displayName: 'Eligible OpenAI',
                  estimatedCost: {
                    microUsd: 100000,
                    vnd: 2500,
                    usdText: '$0.10',
                    vndText: '2,500 ₫',
                  },
                },
                {
                  modelKey: 'google/eligible',
                  displayName: 'Eligible Google',
                  estimatedCost: {
                    microUsd: 50000,
                    vnd: 1250,
                    usdText: '$0.05',
                    vndText: '1,250 ₫',
                  },
                },
              ],
          inputTokensPerCall: 1000,
          outputTokensPerCall: 2000,
          calls: 10,
        },
      };
    } else if (request.method === 'pricing.clearOverride') {
      overridden = false;
      result = {
        version: 'manual-cleared',
        effectiveFrom: '2026-10-02T00:00:00.000Z',
        origin: 'manual_override',
        entries: [],
      };
    } else if (request.method === 'settings.update') {
      selectedModelKey = request.params?.patch?.pricing?.extractionModelKey ?? selectedModelKey;
      result = {};
    } else if (request.method === 'pricing.refresh') {
      result = {
        startedAt: '2026-10-04T00:00:00.000Z',
        finishedAt: '2026-10-04T00:00:10.000Z',
        status: 'applied',
        deltas: [],
        providerOutcomes: [
          { provider: 'openai', status: 'applied', reason: 'Updated one price.' },
          { provider: 'google', status: 'no_change', reason: 'Published prices are unchanged.' },
          { provider: 'anthropic', status: 'rejected_validation', reason: 'Change exceeded the configured limit.' },
          { provider: 'xai', status: 'fetch_failed', reason: 'Pricing page did not respond.' },
          { provider: 'groq', status: 'extraction_failed', reason: 'AI response was not valid JSON.' },
        ],
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
    const row = await screen.findByRole('row', { name: /Eligible OpenAI/ });
    expect(within(row).getByText('Overridden')).toBeVisible();

    fireEvent.click(within(row).getByRole('button', { name: 'Clear override' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Clear manual price override?' });
    expect(dialog).toHaveTextContent('Restore the automatic or seed price for Eligible OpenAI?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear override' }));

    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('"method":"pricing.clearOverride"'))).toBe(true);
      expect(getRowsCalls()).toBeGreaterThan(1);
    });
    expect(screen.queryByText('Overridden')).not.toBeInTheDocument();
  });

  it('warns when a seed row remains in a table containing a manual override', async () => {
    setup({ seedRemaining: true });
    const seedRow = await screen.findByRole('row', { name: /Chat without a key/ });
    expect(within(seedRow).getByRole('link', { name: 'seed (not verified)' })).toBeVisible();
    expect(screen.getByText(/Some prices still come from the shipped seed/)).toBeVisible();
    const manualRow = screen.getByRole('row', { name: /Eligible OpenAI/ });
    expect(within(manualRow).getByRole('link', { name: 'manual' })).toBeVisible();
    expect(screen.getByText('Last updated')).toBeVisible();
  });

  it('shows only backend-eligible keyed models, previews cost, and persists a changed extraction model', async () => {
    const { transport, getRowsCalls } = setup();
    const selector = await screen.findByRole('combobox', { name: 'Model for price extraction' });
    await waitFor(() => expect(selector).toHaveValue('openai/test-model'));
    expect(within(selector).getAllByRole('option')).toHaveLength(2);
    expect(within(selector).queryByRole('option', { name: 'Chat without a key' })).not.toBeInTheDocument();
    expect(within(selector).queryByRole('option', { name: 'Embedding only' })).not.toBeInTheDocument();
    expect(within(selector).queryByRole('option', { name: 'Disabled chat' })).not.toBeInTheDocument();
    expect(screen.getByText('$0.10')).toBeVisible();
    expect(screen.getByText(/up to 10 calls/)).toBeVisible();
    expect(transport.sent.some((line) => line.includes('"method":"pricing.refresh"'))).toBe(false);

    fireEvent.change(selector, { target: { value: 'google/eligible' } });
    await waitFor(() => expect(selector).toHaveValue('google/eligible'));
    expect(screen.getByText('$0.05')).toBeVisible();
    expect(transport.sent.some((line) => line.includes('"pricing":{"extractionModelKey":"google/eligible"}'))).toBe(
      true,
    );
    expect(getRowsCalls()).toBeGreaterThan(1);
    expect(transport.sent.some((line) => line.includes('"method":"pricing.refresh"'))).toBe(false);
  });

  it('explains a missing key and prevents a refresh without a model and estimate', async () => {
    const { transport } = setup({ noKeys: true });
    expect(await screen.findByText(/Add an API key first/)).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Model for price extraction' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Update prices' })).toBeDisabled();
    expect(transport.sent.some((line) => line.includes('"method":"pricing.refresh"'))).toBe(false);
  });

  it('shows each provider outcome and reason with an accessible summary toast', async () => {
    setup();
    const update = screen.getByRole('button', { name: 'Update prices' });
    await waitFor(() => expect(update).toBeEnabled());
    fireEvent.click(update);
    const panel = await screen.findByRole('region', { name: 'Price update results' });
    expect(panel).toHaveTextContent('OpenAI · Prices updated');
    expect(panel).toHaveTextContent('Google · No price changes');
    expect(panel).toHaveTextContent('Anthropic · Price update rejected');
    expect(panel).toHaveTextContent('xAI · Price page fetch failed');
    expect(panel).toHaveTextContent('Groq · Price extraction failed');
    expect(panel).toHaveTextContent('AI response was not valid JSON.');
    expect(panel).toHaveTextContent('Change exceeded the configured limit.');
    const toast = screen.getByText(/Price update finished:/);
    expect(toast).toHaveAttribute('role', 'status');
    expect(toast).toHaveTextContent('1 applied, 1 unchanged, 1 rejected, 1 fetch failures, 1 extraction failures');
  });

  it('keeps RPC refresh failures visible instead of showing success', async () => {
    setup({ failMethod: 'pricing.refresh' });
    const update = screen.getByRole('button', { name: 'Update prices' });
    await waitFor(() => expect(update).toBeEnabled());
    fireEvent.click(update);
    expect(await screen.findByText('Extraction key was rejected.')).toBeVisible();
    expect(screen.getByText('Replace the API key and try again.')).toBeVisible();
    expect(screen.queryByText(/Price update finished:/)).not.toBeInTheDocument();
  });

  it('preserves the selected model and shows an error when settings persistence fails', async () => {
    setup({ failMethod: 'settings.update' });
    const selector = screen.getByRole('combobox', { name: 'Model for price extraction' });
    await waitFor(() => expect(selector).toHaveValue('openai/test-model'));
    fireEvent.change(selector, { target: { value: 'google/eligible' } });
    expect(await screen.findByText('Extraction key was rejected.')).toBeVisible();
    expect(selector).toHaveValue('openai/test-model');
    expect(screen.getByText('$0.10')).toBeVisible();
  });
});
