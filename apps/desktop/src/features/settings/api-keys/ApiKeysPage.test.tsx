import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RpcClient } from '../../../rpc/rpc-client';
import { RpcClientProvider } from '../../../rpc/rpc-context';
import { FakeTransport } from '../../../rpc/transport';
import { SettingsTargetContext } from '../settings-target';
import { QwenEndpoint, QWEN_DEFAULT_ENDPOINT } from './QwenEndpoint';
import { ApiKeysPage } from './ApiKeysPage';

afterEach(cleanup);

interface SetupOptions {
  readonly endpointSaveFails?: boolean;
  readonly qwenEndpoint?: string;
  readonly recoveryFailure?: 'save' | 'delete';
  readonly verifyAndSaveSucceeds?: boolean;
  readonly keepVerifyAndSavePending?: boolean;
  readonly statuses?: readonly Record<string, unknown>[];
  readonly history?: readonly Record<string, unknown>[];
}

function setup(options: SetupOptions = {}) {
  let recoveryFailed = false;
  const transport = new FakeTransport();
  const client = new RpcClient(transport);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  transport.receive(
    JSON.stringify({ jsonrpc: '2.0', method: 'system.ready', params: { version: '0.1.0', recoveredTransactions: 0 } }),
  );
  transport.send = (line: string) => {
    transport.sent.push(line);
    const request = JSON.parse(line) as { id: number; method: string; params: Record<string, unknown> };
    if (request.method === 'settings.get' || request.method === 'settings.update') {
      const result = {
        providers: {
          qwen: { baseUrl: options.qwenEndpoint ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
        },
      };
      const response =
        request.method === 'settings.update' && options.endpointSaveFails === true
          ? {
              error: {
                code: -32000,
                message: 'Endpoint save failed',
                data: {
                  code: 'INTERNAL',
                  message: 'Endpoint save failed',
                  remediation: ['Try again'],
                  retryable: true,
                },
              },
            }
          : { result };
      transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...response }));
      return Promise.resolve();
    }
    if (request.method === 'secrets.verifyAndSave' && options.keepVerifyAndSavePending === true)
      return Promise.resolve();
    if (
      (request.method === 'secrets.verifyAndSave' && options.recoveryFailure === 'save') ||
      (request.method === 'secrets.delete' && options.recoveryFailure === 'delete')
    ) {
      recoveryFailed = true;
      transport.receive(
        JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32000,
            message: 'Could not restore API key state.',
            data: {
              code: 'INTERNAL',
              message: 'Could not restore API key state.',
              remediation: ['Reload API key status before retrying.'],
              retryable: true,
              details: { keyStateMayHaveChanged: true },
            },
          },
        }),
      );
      return Promise.resolve();
    }
    const response =
      request.method === 'secrets.status'
        ? {
            result: recoveryFailed
              ? [{ provider: 'anthropic', configured: options.recoveryFailure !== 'delete', hint: '1234' }]
              : (options.statuses ?? []),
          }
        : request.method === 'secrets.history'
          ? { result: options.history ?? [] }
          : request.method === 'secrets.verifyAndSave' && options.verifyAndSaveSucceeds !== true
            ? {
                error: {
                  code: -32000,
                  message: 'The provider rejected this key.',
                  data: {
                    code: 'PROVIDER_AUTH',
                    message: 'Could not verify the API key for Anthropic.',
                    remediation: ['The provider rejected this key.'],
                    retryable: false,
                  },
                },
              }
            : {
                result: {
                  provider: request.params.provider,
                  configured: request.method !== 'secrets.delete',
                  ...(request.method === 'secrets.verifyAndSave'
                    ? { hint: '1234', lastVerifiedAt: '2026-10-02T12:00:00.000Z' }
                    : {}),
                },
              };
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...response }));
    return Promise.resolve();
  };
  render(
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider client={client}>
        <ApiKeysPage />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
  return { queryClient, transport };
}

function firstButton(name: string): HTMLButtonElement {
  const button = screen.getAllByRole('button', { name })[0];
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${name} button was not rendered`);
  return button;
}

describe('ApiKeysPage', () => {
  it.each(['DeepSeek', 'OpenRouter', 'Qwen (Alibaba Cloud)', 'Mistral'])(
    'PROV-01 lists %s with verify and save',
    async (name) => {
      setup();
      const input = await screen.findByLabelText(name + ' API key');
      const article = input.closest('article');
      if (article === null) throw new Error('Missing provider row');
      expect(within(article).getByRole('button', { name: 'Verify & save' })).toBeVisible();
    },
  );

  it.each([
    ['United States (Virginia)', 'https://dashscope-us.aliyuncs.com/compatible-mode/v1'],
    ['China (Beijing)', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
    ['International (Singapore)', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'],
  ])('PROV-01 saves the Qwen %s endpoint before verifying', async (_name, endpoint) => {
    const { transport } = setup({ verifyAndSaveSucceeds: true });
    const select = await screen.findByLabelText('Region / endpoint');
    await waitFor(() => expect(select).toBeEnabled());
    fireEvent.change(select, { target: { value: endpoint } });
    const input = screen.getByLabelText('Qwen (Alibaba Cloud) API key');
    fireEvent.change(input, { target: { value: 'candidate-test-1234' } });
    const article = input.closest('article');
    if (article === null) throw new Error('Missing Qwen row');
    fireEvent.click(within(article).getByRole('button', { name: 'Verify & save' }));
    await waitFor(() => expect(input).toHaveValue(''));
    const writes = transport.sent.filter(
      (line) => line.includes('settings.update') || line.includes('secrets.verifyAndSave'),
    );
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[0] ?? '{}')).toMatchObject({
      method: 'settings.update',
      params: { patch: { providers: { qwen: { baseUrl: endpoint } } } },
    });
    expect(JSON.parse(writes[1] ?? '{}')).toMatchObject({
      method: 'secrets.verifyAndSave',
      params: { provider: 'qwen' },
    });
  });

  it('PROV-01 restores a custom endpoint and only verifies valid HTTPS URLs', async () => {
    const { transport } = setup({ verifyAndSaveSucceeds: true, qwenEndpoint: 'https://workspace.example/v1' });
    const input = await screen.findByLabelText('Qwen (Alibaba Cloud) API key');
    const custom = await screen.findByLabelText('Custom HTTPS endpoint');
    expect(custom).toHaveValue('https://workspace.example/v1');
    fireEvent.change(input, { target: { value: 'candidate-test-1234' } });
    const article = input.closest('article');
    if (article === null) throw new Error('Missing Qwen row');
    const save = within(article).getByRole('button', { name: 'Verify & save' });
    for (const invalid of ['http://workspace.example/v1', 'bad-url', 'https://' + 'a'.repeat(301)]) {
      fireEvent.change(custom, { target: { value: invalid } });
      expect(save).toBeDisabled();
      fireEvent.click(save);
    }
    expect(transport.sent.some((line) => line.includes('secrets.verifyAndSave'))).toBe(false);
    fireEvent.change(custom, { target: { value: 'https://custom.example/v1' } });
    fireEvent.click(save);
    await waitFor(() => expect(input).toHaveValue(''));
    expect(transport.sent.some((line) => line.includes('https://custom.example/v1'))).toBe(true);
  });

  it('PROV-01 selects Custom and does not verify when endpoint persistence fails', async () => {
    const { transport } = setup({ endpointSaveFails: true });
    const select = await screen.findByLabelText('Region / endpoint');
    await waitFor(() => expect(select).toBeEnabled());
    fireEvent.change(select, { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Custom HTTPS endpoint'), {
      target: { value: 'https://custom.example/v1' },
    });
    const input = screen.getByLabelText('Qwen (Alibaba Cloud) API key');
    fireEvent.change(input, { target: { value: 'candidate-test-1234' } });
    const article = input.closest('article');
    if (article === null) throw new Error('Missing Qwen row');
    fireEvent.click(within(article).getByRole('button', { name: 'Verify & save' }));
    expect(await screen.findByText('Endpoint save failed')).toBeVisible();
    expect(transport.sent.some((line) => line.includes('secrets.verifyAndSave'))).toBe(false);
    expect(input).toHaveValue('candidate-test-1234');
  });
  it('shows an inline hint and makes no RPC call for an empty key', async () => {
    const { transport } = setup();
    await screen.findByRole('status', { name: 'Anthropic key status' });
    fireEvent.click(firstButton('Verify & save'));

    expect(await screen.findByText('Enter an API key before verifying.')).toBeVisible();
    expect(transport.sent.some((line) => line.includes('secrets.verifyAndSave'))).toBe(false);
  });

  it('shows progress and disables controls while verifying', async () => {
    const { transport } = setup({ keepVerifyAndSavePending: true });
    const input = await screen.findByLabelText('Anthropic API key');
    fireEvent.change(input, { target: { value: 'candidate-key-1234' } });
    fireEvent.click(firstButton('Verify & save'));

    expect(await screen.findByRole('button', { name: 'Verifying…' })).toBeDisabled();
    expect(input).toBeDisabled();
    expect(firstButton('Delete')).toBeDisabled();
    expect(transport.sent.some((line) => line.includes('secrets.verifyAndSave'))).toBe(true);
  });

  it('clears a verified key, shows the saved toast and masked status', async () => {
    setup({ verifyAndSaveSucceeds: true });
    const input = await screen.findByLabelText('Anthropic API key');
    const key = 'candidate-key-1234';
    fireEvent.change(input, { target: { value: key } });
    fireEvent.click(firstButton('Verify & save'));

    await waitFor(() => expect(input).toHaveValue(''));
    expect(document.body).not.toHaveTextContent(key);
    expect(await screen.findByText('Anthropic key saved ✓')).toBeVisible();
    expect(await screen.findByRole('status', { name: 'Anthropic key status' })).toHaveTextContent('Verified · …1234');
  });

  it('keeps the candidate and the previous status when verification fails', async () => {
    setup({
      statuses: [{ provider: 'anthropic', configured: true, hint: 'old1' }],
    });
    const input = await screen.findByLabelText('Anthropic API key');
    const key = 'candidate-key-1234';
    fireEvent.change(input, { target: { value: key } });
    fireEvent.click(firstButton('Verify & save'));

    expect(await screen.findByText('Could not verify the API key for Anthropic.')).toBeVisible();
    expect(input).toHaveValue(key);
    expect(screen.getByRole('status', { name: 'Anthropic key status' })).toHaveTextContent('Set ••••old1');
  });

  it.each(['save', 'delete'] as const)('refreshes actual key status after failed %s recovery', async (action) => {
    const { transport } = setup({
      recoveryFailure: action,
      statuses: [{ provider: 'anthropic', configured: true, hint: 'old1', lastVerifiedAt: '2026-10-02T12:00:00.000Z' }],
    });
    const status = await screen.findByRole('status', { name: 'Anthropic key status' });
    await waitFor(() => expect(status).toHaveTextContent('Verified · …old1'));
    if (action === 'save') {
      fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'candidate-key-1234' } });
      fireEvent.click(firstButton('Verify & save'));
    } else {
      fireEvent.click(firstButton('Delete'));
      const dialog = await screen.findByRole('alertdialog', { name: 'Delete API key?' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    }

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not restore API key state.');
    await waitFor(() => expect(status).toHaveTextContent(action === 'save' ? 'Set ••••1234' : 'Not set'));
    expect(transport.sent.filter((line) => line.includes('secrets.status')).length).toBeGreaterThan(1);
    expect(status).not.toHaveTextContent('Verified');
  });

  it('renders masked provider history in the collapsible section', async () => {
    setup({
      history: [
        {
          id: '123e4567-e89b-42d3-a456-426614174000',
          provider: 'anthropic',
          hint: '9876',
          action: 'verify_failed',
          resultCode: 'PROVIDER_AUTH',
          at: '2026-10-02T12:00:00.000Z',
        },
      ],
    });
    fireEvent.click(await screen.findByText('Key history'));
    expect(await screen.findByText('••••9876')).toBeVisible();
    expect(screen.getByText('Verification failed (PROVIDER_AUTH)')).toBeVisible();
  });

  it('shows an alert when an in-flight RPC is rejected after a sidecar restart', async () => {
    const { transport } = setup({ keepVerifyAndSavePending: true });
    const input = await screen.findByLabelText('Anthropic API key');
    fireEvent.change(input, { target: { value: 'interrupted-key-1234' } });
    fireEvent.click(firstButton('Verify & save'));
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('secrets.verifyAndSave'))).toBe(true);
    });

    act(() => {
      transport.setStatus({ running: false, ready: false, restarts: 1 });
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('sidecar restarted');
  });

  it('cancels deletion from the accessible dialog', async () => {
    const { transport } = setup();
    fireEvent.click(firstButton('Delete'));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete API key?' });
    expect(dialog).toHaveTextContent('Delete the Anthropic API key?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(transport.sent.some((line) => line.includes('secrets.delete'))).toBe(false);
  });

  it('deletes a key after accessible confirmation', async () => {
    const { transport } = setup();
    fireEvent.click(firstButton('Delete'));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete API key?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('secrets.delete'))).toBe(true);
    });
  });
});

it('TC-OWNER-FB3-016 search reveals a conditional endpoint field without changing saved preferences', () => {
  const change = vi.fn();
  render(
    <SettingsTargetContext value="qwen-custom-url">
      <QwenEndpoint endpoint={QWEN_DEFAULT_ENDPOINT} disabled={false} onChange={change} />
    </SettingsTargetContext>,
  );
  expect(screen.getByLabelText('Custom HTTPS endpoint')).toHaveValue(QWEN_DEFAULT_ENDPOINT);
  expect(change).not.toHaveBeenCalled();
});
