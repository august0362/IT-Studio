import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { RpcClient } from '../../../rpc/rpc-client';
import { RpcClientProvider } from '../../../rpc/rpc-context';
import { FakeTransport } from '../../../rpc/transport';
import { ThemePage } from './ThemePage';
import { ThemeSync } from '../../../theme/ThemeSync';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

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
        <ThemeSync />
        <ThemePage />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
  return { transport };
}

describe('ThemePage', () => {
  it('lists all new dark-native themes in the dark filter', async () => {
    setup();
    await screen.findByRole('radio', { name: /Neon Gold/ });
    fireEvent.click(screen.getByRole('button', { name: 'Dark-native' }));
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByRole('radio', { name: /Neon Gold/ })).toBeVisible();
    expect(screen.getByRole('radio', { name: /Neon Cyan/ })).toBeVisible();
    expect(screen.getByRole('radio', { name: /Neon Violet/ })).toBeVisible();
    expect(screen.queryByRole('radio', { name: /Arctic Focus/ })).toBeNull();
  });

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

it('UX-05 appearance controls apply immediately and persist across remounts and theme changes', async () => {
  const { transport } = setup();
  await screen.findByRole('radio', { name: /Arctic Focus/ });
  fireEvent.change(screen.getByRole('combobox', { name: 'Density' }), { target: { value: 'compact' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'UI font size' }), { target: { value: 'large' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Accent colour' }), { target: { value: 'ocean' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Motion' }), { target: { value: 'reduced' } });
  expect(document.documentElement.dataset.density).toBe('compact');
  expect(document.documentElement.dataset.motion).toBe('reduced');
  expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.125');
  expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe(
    document.documentElement.style.getPropertyValue('--color-info'),
  );
  fireEvent.click(screen.getByRole('radio', { name: /Midnight Focus/ }));
  await waitFor(() => {
    expect(transport.sent.some((line) => line.includes('settings.update'))).toBe(true);
  });
  expect(JSON.parse(localStorage.getItem('itstudio.theme') ?? '{}')).toMatchObject({
    density: 'compact',
    fontScale: 'large',
    accent: 'ocean',
    motion: 'reduced',
  });
  cleanup();
  setup();
  expect(screen.getByRole('combobox', { name: 'Density' })).toHaveValue('compact');
  expect(screen.getByRole('combobox', { name: 'Motion' })).toHaveValue('reduced');
  expect(screen.getByRole('combobox', { name: 'UI font size' })).toHaveValue('large');
  expect(screen.getByRole('combobox', { name: 'Accent colour' })).toHaveValue('ocean');
});
