import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { RpcClient } from '../../../rpc/rpc-client';
import { RpcClientProvider } from '../../../rpc/rpc-context';
import { FakeTransport } from '../../../rpc/transport';
import { ThemePage } from './ThemePage';

afterEach(cleanup);

function setup() {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  transport.send = (line: string) => {
    transport.sent.push(line);
    const request: unknown = JSON.parse(line);
    if (typeof request !== 'object' || request === null || !('id' in request) || !('params' in request)) {
      return Promise.resolve();
    }
    if (typeof request.id !== 'number' || typeof request.params !== 'object' || request.params === null) {
      return Promise.resolve();
    }
    const current = { themeId: 'arctic-focus', mode: 'system', locale: 'en' };
    const parameters = request.params;
    const patch = 'patch' in parameters ? parameters.patch : undefined;
    const uiPatch = typeof patch === 'object' && patch !== null && 'ui' in patch ? patch.ui : undefined;
    const ui = typeof uiPatch === 'object' && uiPatch !== null ? { ...current, ...uiPatch } : current;
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { ui } }));
    return Promise.resolve();
  };
  const client = new RpcClient(transport);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider client={client}>
        <ThemePage />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
  return { transport };
}

describe('ThemePage', () => {
  it('supports arrow key navigation and applies with Space', async () => {
    const { transport } = setup();
    const arctic = await screen.findByRole('radio', { name: /Arctic Focus/ });
    arctic.focus();
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    expect(document.activeElement).toHaveAttribute('data-theme-id', 'midnight-focus');
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: ' ' });
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('settings.update'))).toBe(true);
    });
  });

  it('hover preview does not persist and clicking a card calls settings.update', async () => {
    const { transport } = setup();
    const midnight = await screen.findByRole('radio', { name: /Midnight Focus/ });
    const card = midnight.parentElement;
    if (card === null) throw new Error('Theme card wrapper is missing');
    fireEvent.mouseEnter(card);
    expect(screen.getByRole('heading', { name: 'Midnight Focus preview' })).toBeVisible();
    expect(transport.sent.some((line) => line.includes('settings.update'))).toBe(false);
    fireEvent.click(midnight);
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('settings.update'))).toBe(true);
    });
    expect(transport.sent.find((line) => line.includes('settings.update'))).toContain('midnight-focus');
  });
});
