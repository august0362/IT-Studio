import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import { RpcClient } from '../rpc/rpc-client';
import { RpcClientProvider } from '../rpc/rpc-context';
import { FakeTransport } from '../rpc/transport';
import { AppShell } from './AppShell';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  void i18n.changeLanguage('en');
});

function setup() {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  const project = {
    id: 'project-1',
    name: 'Project One',
    workspaceRoot: 'C:/project-one',
    createdAt: '2026-01-01T00:00:00.000Z',
    archived: false,
  };
  const settings = { activeProjectId: project.id, ui: { themeId: 'arctic-focus', mode: 'system', locale: 'en' } };
  transport.send = (line) => {
    transport.sent.push(line);
    const request: unknown = JSON.parse(line);
    if (typeof request !== 'object' || request === null || !('id' in request) || !('method' in request))
      return Promise.resolve();
    const message = request as { id: number; method: string; params: Record<string, unknown> };
    let result: unknown = undefined;
    if (message.method === 'project.list') result = [project];
    else if (message.method === 'settings.get') result = settings;
    else if (message.method === 'project.setActive') result = project;
    else if (message.method === 'project.create')
      result = { ...project, id: 'project-2', name: message.params.name, workspaceRoot: message.params.workspaceRoot };
    else if (message.method === 'secrets.status') result = [];
    else if (message.method === 'system.ping') result = { version: '0.1.0' };
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    return Promise.resolve();
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = new RpcClient(transport);
  render(
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider client={client}>
        <AppShell />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
  return transport;
}

describe('AppShell', () => {
  it('keeps the main navigation in keyboard order and marks Gallery unavailable', () => {
    setup();
    const links = screen.getAllByRole('link');
    expect(links.slice(0, 6).map((link) => link.getAttribute('href'))).toEqual([
      '#chat',
      '#code',
      '#knowledge',
      '#cost',
      '#settings-api-keys',
      '#settings-theme',
    ]);
    expect(screen.getByText(/Gallery/)).toHaveAttribute('aria-disabled', 'true');
    expect(document.querySelector('footer[role="status"]')).toBeVisible();
  });

  it('opens and activates project tabs through RPC, and allows closing them', async () => {
    const transport = setup();
    await screen.findByRole('tab', { name: 'Project One' });
    fireEvent.click(screen.getByRole('tab', { name: 'Project One' }));
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('project.setActive'))).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close Project One' }));
    expect(screen.queryByRole('tab', { name: 'Project One' })).not.toBeInTheDocument();
  });

  it('shows validation errors in the new project dialog', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a project name.');
  });

  it('re-renders navigation labels when the selected locale changes', async () => {
    setup();
    await screen.findByRole('link', { name: 'Chat' });
    await i18n.changeLanguage('vi');
    expect(await screen.findByRole('link', { name: 'Trò chuyện' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Khóa API' })).toBeVisible();
  });

  it('tolerates localStorage failures while rendering open tabs', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    setup();
    expect(await screen.findByRole('tab', { name: 'Project One' })).toBeVisible();
  });
});
