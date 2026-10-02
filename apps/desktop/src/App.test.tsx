import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { RpcClient } from './rpc/rpc-client';
import { RpcClientProvider } from './rpc/rpc-context';
import { FakeTransport } from './rpc/transport';
import { App } from './App';

describe('App', () => {
  it('renders the Settings navigation, API keys page, and status bar', () => {
    const transport = new FakeTransport();
    const rpcClient = new RpcClient(transport);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <RpcClientProvider client={rpcClient}>
          <App />
        </RpcClientProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('heading', { name: 'IT Studio' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'API keys' })).toBeVisible();
    expect(screen.getByText('Connecting…')).toBeVisible();
  });
});
