import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RpcClient } from '../rpc/rpc-client';
import { RpcClientProvider } from '../rpc/rpc-context';
import { FakeTransport } from '../rpc/transport';
import { ThemeSync } from './ThemeSync';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('ThemeSync', () => {
  it('follows system color scheme changes live', async () => {
    let prefersDark = false;
    let listener: (() => void) | undefined;
    const media = {
      get matches() {
        return prefersDark;
      },
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: (_type: string, callback: () => void) => {
        listener = callback;
      },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
    vi.spyOn(window, 'matchMedia').mockReturnValue(media);
    const transport = new FakeTransport();
    transport.setStatus({ running: true, ready: true, restarts: 0 });
    transport.send = (line: string) => {
      const request: unknown = JSON.parse(line);
      if (typeof request === 'object' && request !== null && 'id' in request && typeof request.id === 'number') {
        transport.receive(
          JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: { ui: { themeId: 'arctic-focus', mode: 'system' } },
          }),
        );
      }
      return Promise.resolve();
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <RpcClientProvider client={new RpcClient(transport)}>
          <ThemeSync />
        </RpcClientProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(document.documentElement.dataset.mode).toBe('light');
    });
    prefersDark = true;
    listener?.();
    await waitFor(() => {
      expect(document.documentElement.dataset.mode).toBe('dark');
    });
  });
});
