import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import { RpcClient } from '../rpc/rpc-client';
import { RpcClientProvider } from '../rpc/rpc-context';
import { FakeTransport } from '../rpc/transport';
import { AppShell } from './AppShell';
import * as webChatHosts from '../features/webchat/webchat-host';

function mockNativeHost(closeAll = vi.fn(() => Promise.resolve())) {
  const host = {
    available: true,
    sync: vi.fn(() => Promise.resolve()),
    setVisible: vi.fn(() => Promise.resolve()),
    reload: vi.fn(() => Promise.resolve()),
    closeAll,
  } satisfies webChatHosts.IWebChatHost;
  vi.spyOn(webChatHosts, 'createWebChatHost').mockReturnValue(host);
  return host;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '#settings-api-keys');
  void i18n.changeLanguage('en');
});

function setup({ history = false, empty = false, conflict = false, delayed = false } = {}) {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  const project = {
    id: 'project-1',
    name: 'Project One',
    workspaceRoot: 'C:/project-one',
    createdAt: '2026-01-01T00:00:00.000Z',
    archived: false,
  };
  const secondProject = {
    ...project,
    id: 'project-2',
    name: 'Second Project',
    workspaceRoot: 'C:/second',
    lastOpenedAt: '2026-10-15T12:00:00.000Z',
  };
  let projects = empty ? [] : history ? [secondProject, project] : [project];
  const settings = {
    activeProjectId: project.id,
    ui: { themeId: 'arctic-focus', mode: 'system', locale: 'en' },
    webChat: {
      browser: 'coccoc',
      customBrowserPath: null,
      links: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true }],
    },
  };
  transport.send = (line) => {
    transport.sent.push(line);
    const request: unknown = JSON.parse(line);
    if (typeof request !== 'object' || request === null || !('id' in request) || !('method' in request))
      return Promise.resolve();
    const message = request as { id: number; method: string; params: Record<string, unknown> };
    let result: unknown = undefined;
    if (message.method === 'project.list') {
      if (delayed) return Promise.resolve();
      result = projects;
    } else if (message.method === 'settings.get') result = settings;
    else if (message.method === 'project.setActive') {
      settings.activeProjectId = String(message.params.projectId);
      result = projects.find((item) => item.id === settings.activeProjectId);
    } else if (message.method === 'project.delete') {
      if (conflict) {
        transport.receive(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32000,
              message: 'running',
              data: { code: 'CONFLICT', message: 'running', retryable: false, remediation: ['Cancel the pipeline.'] },
            },
          }),
        );
        return Promise.resolve();
      }
      projects = projects.filter((item) => item.id !== message.params.projectId);
      result = { deleted: true };
    } else if (message.method === 'project.create')
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
  it('keeps the main navigation in keyboard order and enables Gallery', () => {
    setup();
    const links = within(screen.getByRole('navigation', { name: 'Main navigation' })).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#projects',
      '#chat',
      '#webchat',
      '#code',
      '#knowledge',
      '#gallery',
      '#cost',
      '#workflow',
      '#settings',
    ]);
    expect(screen.getByRole('link', { name: 'Gallery' })).toHaveAttribute('href', '#gallery');
    expect(
      within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Web chat' }),
    ).toHaveAttribute('href', '#webchat');
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

  it('opens the internal Web chat page through main navigation', async () => {
    setup();
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Web chat' }),
    );
    expect(await screen.findByRole('heading', { name: 'Web chat' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Panes' })).toBeVisible();
    expect(window.location.hash).toBe('#webchat');
  });

  it('waits for native pane closure before applying a hash route change', async () => {
    let finishClose: (() => void) | undefined;
    const closeComplete = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const host = mockNativeHost(vi.fn(() => closeComplete));
    window.history.replaceState(null, '', '#webchat');
    setup();
    await screen.findByRole('heading', { name: 'Web chat' });

    act(() => {
      window.history.replaceState(null, '', '#settings-api-keys');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(host.closeAll).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Web chat' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'API keys' })).not.toBeInTheDocument();
    await act(async () => {
      finishClose?.();
      await closeComplete;
    });

    expect(await screen.findByRole('heading', { name: 'API keys' })).toBeVisible();
    expect(window.location.hash).toBe('#settings-api-keys');
  });

  it('keeps the current route and reports a native pane closure failure', async () => {
    mockNativeHost(vi.fn(() => Promise.reject(new Error('close failed'))));
    window.history.replaceState(null, '', '#webchat');
    setup();
    await screen.findByRole('heading', { name: 'Web chat' });
    act(() => {
      window.history.replaceState(null, '', '#settings-api-keys');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('The request could not be completed.');
    expect(screen.getByRole('heading', { name: 'Web chat' })).toBeVisible();
    expect(window.location.hash).toBe('#webchat');
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
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    setup();
    expect(await screen.findByRole('tab', { name: 'Project One' })).toBeVisible();
  });

  it('lists project history in server order with dates, folders and search by name or path', async () => {
    window.history.replaceState(null, '', '#projects');
    setup({ history: true });
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    const firstRow = rows[0];
    if (firstRow === undefined) throw new Error('Missing project row');
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Second Project',
      'Project One',
    ]);
    expect(within(firstRow).getByTitle('C:/second')).toHaveClass('truncate');
    expect(within(table).getByText('Never')).toBeVisible();
    expect(within(firstRow).getByTitle('2026-10-15T12:00:00.000Z')).toHaveAttribute(
      'datetime',
      '2026-10-15T12:00:00.000Z',
    );
    expect(within(table).getAllByTitle('2026-01-01T00:00:00.000Z')).toHaveLength(2);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'SECOND' } });
    expect(within(table).queryByText('Project One')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'C:/project-one' } });
    expect(within(table).queryByText('Second Project')).not.toBeInTheDocument();
    expect(within(table).getByText('Project One')).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
    expect(screen.getByText('No projects match your search.')).toBeVisible();
  });

  it('reopens a hidden project through setActive and navigates to Chat', async () => {
    const transport = setup({ history: true });
    const close = await screen.findByRole('button', { name: 'Close Project One' });
    expect(close).toHaveAttribute('title', 'Close tab (project stays in Projects)');
    fireEvent.click(close);
    fireEvent.click(screen.getByRole('link', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Second Project' }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#chat');
    });
    expect(screen.getByRole('tab', { name: 'Second Project' })).toHaveAttribute('aria-selected', 'true');
    expect(transport.sent.some((line) => line.includes('project.setActive') && line.includes('project-2'))).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Projects' }));
    expect(await screen.findByRole('button', { name: 'Open Project One' })).toBeVisible();
  });

  it('requires delete confirmation, then removes the history row and open tab and refetches', async () => {
    window.history.replaceState(null, '', '#projects');
    const transport = setup();
    await screen.findByRole('tab', { name: 'Project One' });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Project One' }));
    let dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Files in C:/project-one are not touched.');
    expect(dialog).toHaveTextContent('Its chats, pipeline runs, knowledge index, images and cost records are removed.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(transport.sent.some((line) => line.includes('project.delete'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Project One' }));
    dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveAttribute('data-tone', 'danger');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Delete Project One' })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('tab', { name: 'Project One' })).not.toBeInTheDocument();
    expect(transport.sent.some((line) => line.includes('project.delete') && line.includes('project-1'))).toBe(true);
    expect(transport.sent.filter((line) => line.includes('project.list')).length).toBeGreaterThan(1);
  });

  it('keeps the row and tab on CONFLICT and shows remediation', async () => {
    window.history.replaceState(null, '', '#projects');
    setup({ conflict: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Project One' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A pipeline is running in this project — cancel it first',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Cancel the pipeline.');
    expect(screen.getByRole('tab', { name: 'Project One' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Delete Project One' })).toBeVisible();
  });

  it('offers the existing New project dialog from an empty history', async () => {
    window.history.replaceState(null, '', '#projects');
    setup({ empty: true });
    expect(await screen.findByText('No projects yet. Create a new project to get started.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeVisible();
  });

  it('restores tab order and the active selection, synchronizes setActive and drops deleted IDs', async () => {
    localStorage.setItem('itstudio.openProjects', JSON.stringify(['deleted', 'project-1', 'project-2']));
    localStorage.setItem('itstudio.activeProject', JSON.stringify('project-2'));
    const transport = setup({ history: true });
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Second Project' })).toHaveAttribute('aria-selected', 'true');
    });
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'All projects',
      'Project One',
      'Second Project',
    ]);
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('project.setActive') && line.includes('project-2'))).toBe(
        true,
      );
    });
    expect(JSON.parse(localStorage.getItem('itstudio.openProjects') ?? 'null')).toEqual(['project-1', 'project-2']);
    expect(JSON.parse(localStorage.getItem('itstudio.activeProject') ?? 'null')).toBe('project-2');
  });

  it('restores an intentionally empty tab list without reopening the configured active project', async () => {
    localStorage.setItem('itstudio.openProjects', '[]');
    localStorage.setItem('itstudio.activeProject', 'null');
    setup();
    await screen.findByRole('heading', { name: 'API keys' });
    expect(screen.queryByRole('tab', { name: 'Project One' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All projects' })).toHaveAttribute('aria-selected', 'true');
  });

  it('does not overwrite stored tabs while the initial project list is loading', async () => {
    localStorage.setItem('itstudio.openProjects', '["project-1"]');
    localStorage.setItem('itstudio.activeProject', '"project-1"');
    const transport = setup({ delayed: true });
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('project.list'))).toBe(true);
    });
    expect(localStorage.getItem('itstudio.openProjects')).toBe('["project-1"]');
    expect(localStorage.getItem('itstudio.activeProject')).toBe('"project-1"');
    const request: unknown = JSON.parse(transport.sent.find((line) => line.includes('project.list')) ?? '{}');
    if (typeof request !== 'object' || request === null || !('id' in request)) throw new Error('Missing request');
    act(() => {
      transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: [] }));
    });
    await waitFor(() => {
      expect(localStorage.getItem('itstudio.openProjects')).toBe('[]');
    });
  });
});
