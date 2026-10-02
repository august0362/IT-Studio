import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RpcClient } from '../../../rpc/rpc-client';
import { RpcClientProvider } from '../../../rpc/rpc-context';
import { FakeTransport } from '../../../rpc/transport';
import { ApiKeysPage } from './ApiKeysPage';

afterEach(cleanup);

function setup(verifySucceeds = false) {
  const transport = new FakeTransport();
  const client = new RpcClient(transport);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  transport.receive(
    JSON.stringify({ jsonrpc: '2.0', method: 'system.ready', params: { version: '0.1.0', recoveredTransactions: 0 } }),
  );
  transport.send = (line: string) => {
    transport.sent.push(line);
    const request = JSON.parse(line) as { id: number; method: string; params: Record<string, string> };
    const response =
      request.method === 'secrets.status'
        ? { result: [] }
        : request.method === 'secrets.verify' && !verifySucceeds
          ? {
              error: {
                code: -32000,
                message: 'Invalid key',
                data: {
                  code: 'PROVIDER_AUTH',
                  message: 'The API key was rejected.',
                  remediation: ['Check the key and try again.'],
                  retryable: false,
                },
              },
            }
          : {
              result: {
                provider: request.params.provider,
                configured: request.method !== 'secrets.delete',
                ...(request.method === 'secrets.verify' ? { lastVerifiedAt: '2026-10-02T12:00:00.000Z' } : {}),
                ...(request.method === 'secrets.set' ? { hint: '1234' } : {}),
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

describe('ApiKeysPage', () => {
  it('clears the key on save and never renders it back', async () => {
    setup();
    const key = 'example-placeholder-key';
    expect(await screen.findByRole('status', { name: 'Anthropic key status' })).toHaveTextContent('Not set');
    const input = screen.getByLabelText('Anthropic API key');
    fireEvent.change(input, { target: { value: key } });
    const saveButtons = screen.getAllByRole('button', { name: 'Save' });
    const saveButton = saveButtons[0];
    if (saveButton === undefined) throw new Error('Anthropic Save button was not rendered');
    fireEvent.click(saveButton);

    await waitFor(() => expect(input).toHaveValue(''));
    expect(document.body).not.toHaveTextContent(key);
    expect(await screen.findByText('Set ••••1234')).toBeVisible();
  });

  it('shows the verification time when verification succeeds', async () => {
    setup(true);
    expect(await screen.findByRole('status', { name: 'Anthropic key status' })).toHaveTextContent('Not set');
    const verifyButtons = screen.getAllByRole('button', { name: 'Verify' });
    const verifyButton = verifyButtons[0];
    if (verifyButton === undefined) throw new Error('Anthropic Verify button was not rendered');
    fireEvent.click(verifyButton);

    expect(await screen.findByText(/^Verified at /)).toBeVisible();
  });

  it('shows verification failures and remediation', async () => {
    setup();
    expect(await screen.findByRole('status', { name: 'Anthropic key status' })).toHaveTextContent('Not set');
    const verifyButtons = screen.getAllByRole('button', { name: 'Verify' });
    const verifyButton = verifyButtons[0];
    if (verifyButton === undefined) throw new Error('Anthropic Verify button was not rendered');
    fireEvent.click(verifyButton);

    expect(await screen.findByText('Invalid')).toBeVisible();
    expect(screen.getByText('The API key was rejected.')).toBeVisible();
    expect(screen.getByText('Check the key and try again.')).toBeVisible();
  });

  it('asks for confirmation before deleting a key', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { queryClient } = setup();
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    const deleteButton = deleteButtons[0];
    if (deleteButton === undefined) throw new Error('Anthropic Delete button was not rendered');
    fireEvent.click(deleteButton);
    expect(confirm).toHaveBeenCalledWith('Delete the Anthropic API key?');
    expect(queryClient.getQueryCache().findAll({ queryKey: ['secrets.status', {}] })).toHaveLength(1);
    confirm.mockRestore();
  });

  it('deletes a key after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { transport } = setup();
    expect(await screen.findByRole('status', { name: 'Anthropic key status' })).toHaveTextContent('Not set');
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    const deleteButton = deleteButtons[0];
    if (deleteButton === undefined) throw new Error('Anthropic Delete button was not rendered');
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith('Delete the Anthropic API key?');
    });
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('"method":"secrets.delete"'))).toBe(true);
    });
    confirm.mockRestore();
  });
});
