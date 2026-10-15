import type { ProjectId } from '@itstudio/schemas';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';
import { RevenueForm } from './RevenueForm';

afterEach(cleanup);

function setup() {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  const pending: number[] = [];
  transport.send = (line) => {
    const request = JSON.parse(line) as { readonly id: number };
    pending.push(request.id);
    return Promise.resolve();
  };
  const onAdded = vi.fn();
  const client = new RpcClient(transport);
  const view = render(
    <RpcClientProvider client={client}>
      <RevenueForm projectId={'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as ProjectId} rows={[]} onAdded={onAdded} />
    </RpcClientProvider>,
  );
  const form = view.container.querySelector('form');
  if (form === null) throw new Error('Revenue form missing');
  return { transport, client, pending, onAdded, form };
}

describe('RevenueForm', () => {
  it.each([false, true])(
    'QA-BREAK-02-D01 guards form submissions and permits retry after failure=%s',
    async (fails) => {
      const { transport, client, pending, onAdded, form } = setup();
      const amount = screen.getByLabelText('Amount');
      const description = screen.getByLabelText('Description');
      const add = screen.getByRole('button', { name: 'Add revenue' });
      fireEvent.change(amount, { target: { value: '1' } });
      fireEvent.change(description, { target: { value: 'Invoice' } });
      await act(async () => {
        fireEvent.submit(form);
        fireEvent.submit(form);
        await Promise.resolve();
      });
      expect(pending).toHaveLength(1);
      expect(add).toBeDisabled();
      await act(async () => {
        transport.receive(
          JSON.stringify({
            jsonrpc: '2.0',
            id: pending[0],
            ...(fails ? { error: { code: -32603, message: 'Revenue could not be saved' } } : { result: {} }),
          }),
        );
        await Promise.resolve();
      });
      expect(add).toBeEnabled();
      expect(onAdded).toHaveBeenCalledTimes(fails ? 0 : 1);
      if (fails) {
        expect(screen.getByRole('alert')).toHaveTextContent('Revenue could not be saved');
        expect(amount).toHaveValue('1');
        expect(description).toHaveValue('Invoice');
      } else {
        expect(amount).toHaveValue('');
        expect(description).toHaveValue('');
        fireEvent.change(amount, { target: { value: '2' } });
        fireEvent.change(description, { target: { value: 'Next invoice' } });
      }
      await act(async () => {
        fireEvent.submit(form);
        await Promise.resolve();
      });
      expect(pending).toHaveLength(2);
      await act(async () => {
        transport.receive(JSON.stringify({ jsonrpc: '2.0', id: pending[1], result: {} }));
        await Promise.resolve();
      });
      client.dispose();
    },
  );

  it('QA-BREAK-02-D01 leaves invalid submissions editable without sending revenue', async () => {
    const { client, pending, form } = setup();
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });
    expect(pending).toHaveLength(0);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add revenue' })).toBeEnabled();
    client.dispose();
  });
});
