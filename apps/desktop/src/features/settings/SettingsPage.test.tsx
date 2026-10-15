import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';
import { AppShell } from '../../shell/AppShell';

// Keep navigation tests independent of the forms' RPC data and validation.
vi.mock('./api-keys/ApiKeysPage', () => ({ ApiKeysPage: () => <p>API keys form</p> }));
vi.mock('./router/RouterSettingsPage', () => ({ RouterSettingsPage: () => <p>Router form</p> }));
vi.mock('./pipeline/PipelineSettingsPage', () => ({ PipelineSettingsPage: () => <p>Pipeline form</p> }));
vi.mock('./budget/BudgetSettingsPage', () => ({ BudgetSettingsPage: () => <p>Budget form</p> }));
vi.mock('./pricing/PricingSettingsPage', () => ({
  PricingSettingsPage: ({ projectActive }: { readonly projectActive: boolean }) => (
    <p>Pricing form: {String(projectActive)}</p>
  ),
}));
vi.mock('./fx/FxSettingsPage', () => ({ FxSettingsPage: () => <p>FX form</p> }));
vi.mock('./images/ImagesSettingsPage', () => ({ ImagesSettingsPage: () => <p>Images form</p> }));
vi.mock('../webchat/ResolvedWebChatSettingsPage', () => ({ ResolvedWebChatSettingsPage: () => <p>Web chat form</p> }));
vi.mock('./vscode/VSCodeSettingsPage', () => ({ VSCodeSettingsPage: () => <p>VS Code form</p> }));
vi.mock('./theme/ThemePage', () => ({ ThemePage: () => <p>Theme form</p> }));

const clients: RpcClient[] = [];
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '#settings-api-keys');
  void i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.dispose();
  vi.restoreAllMocks();
  localStorage.clear();
});

function setup() {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  transport.send = (line) => {
    const request: unknown = JSON.parse(line);
    if (typeof request === 'object' && request !== null && 'id' in request && 'method' in request) {
      const result =
        request.method === 'settings.get'
          ? { activeProjectId: null }
          : request.method === 'system.ping'
            ? { version: '0.1.0' }
            : [];
      transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    }
    return Promise.resolve();
  };
  const client = new RpcClient(transport);
  clients.push(client);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RpcClientProvider client={client}>
        <AppShell />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
}

function hashNavigate(hash: string): void {
  act(() => {
    window.history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

function sectionNav() {
  return within(screen.getByRole('navigation', { name: 'Settings section' }));
}

describe('UX-03 Settings navigation', () => {
  it.each([
    ['api-keys', 'API keys', 'API keys form'],
    ['router', 'Router', 'Router form'],
    ['pipeline', 'Pipeline', 'Pipeline form'],
    ['budget', 'Budget', 'Budget form'],
    ['pricing', 'Pricing', 'Pricing form: false'],
    ['fx', 'Currency (FX)', 'FX form'],
    ['images', 'Images', 'Images form'],
    ['web-chat', 'Web chat', 'Web chat form'],
    ['vscode', 'VS Code', 'VS Code form'],
    ['theme', 'Appearance & language', 'Theme form'],
    ['labs', 'Labs', null],
  ])('opens #settings-%s directly with the matching page and focused heading', (section, title, form) => {
    window.history.replaceState(null, '', `#settings-${section}`);
    setup();
    expect(screen.getByRole('heading', { name: `Settings — ${title}` })).toHaveFocus();
    expect(sectionNav().getByRole('link', { name: title })).toHaveAttribute('aria-current', 'page');
    if (form !== null) expect(screen.getByText(form)).toBeVisible();
    expect(
      within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Settings' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('lists sections in order and moves focus after link, select and hash navigation', () => {
    setup();
    expect(
      sectionNav()
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'API keys',
      'Router',
      'Pipeline',
      'Budget',
      'Pricing',
      'Currency (FX)',
      'Images',
      'Web chat',
      'VS Code',
      'Appearance & language',
      'Labs',
    ]);
    fireEvent.click(sectionNav().getByRole('link', { name: 'Pipeline' }));
    expect(window.location.hash).toBe('#settings-pipeline');
    expect(screen.getByRole('heading', { name: 'Settings — Pipeline' })).toHaveFocus();
    fireEvent.change(screen.getByRole('combobox', { name: 'Settings section' }), { target: { value: 'settings-fx' } });
    expect(screen.getByRole('heading', { name: 'Settings — Currency (FX)' })).toHaveFocus();
    hashNavigate('#settings-theme');
    expect(screen.getByRole('heading', { name: 'Settings — Appearance & language' })).toHaveFocus();
    expect(sectionNav().getByRole('link', { name: 'Currency (FX)' })).not.toHaveAttribute('aria-current');
  });

  it.each([
    ['  PRICING  ', 'Pricing'],
    ['key', 'API keys'],
    ['fallback', 'Router'],
    ['budget', 'Budget'],
    ['theme', 'Appearance & language'],
    ['dark', 'Appearance & language'],
    ['language', 'Appearance & language'],
    ['VND', 'Currency (FX)'],
  ])('filters links and narrow-window options by title or keyword: %s', (query, title) => {
    setup();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search settings' }), { target: { value: query } });
    expect(
      sectionNav()
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([title]);
    expect(
      within(screen.getByRole('combobox', { name: 'Settings section' }))
        .getAllByRole('option')
        .filter((option) => !option.hasAttribute('disabled'))
        .map((option) => option.textContent),
    ).toEqual([title]);
    expect(screen.getByText('API keys form')).toBeVisible();
  });

  it('shows no matches without changing the current page, and clearing search restores sections', () => {
    setup();
    const search = screen.getByRole('searchbox', { name: 'Search settings' });
    fireEvent.change(search, { target: { value: 'no-such-setting' } });
    expect(sectionNav().queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText('No settings sections match your search.')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Settings section' })).toBeDisabled();
    expect(screen.getByText('API keys form')).toBeVisible();
    fireEvent.change(search, { target: { value: '' } });
    expect(sectionNav().getAllByRole('link')).toHaveLength(11);
  });

  it('remembers the last section on sidebar re-entry and reload; an explicit deep link overrides it', () => {
    const view = setup();
    fireEvent.click(sectionNav().getByRole('link', { name: 'Router' }));
    expect(localStorage.getItem('itstudio.settingsSection')).toBe('settings-router');
    fireEvent.click(screen.getByRole('link', { name: 'Projects' }));
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings — Router' })).toHaveFocus();
    view.unmount();
    window.history.replaceState(null, '', '#settings');
    setup();
    expect(screen.getByText('Router form')).toBeVisible();
    hashNavigate('#settings-images');
    expect(screen.getByText('Images form')).toBeVisible();
  });

  it('falls back safely for an invalid stored section and tolerates unavailable storage', () => {
    localStorage.setItem('itstudio.settingsSection', 'settings-unknown');
    window.history.replaceState(null, '', '#settings');
    const view = setup();
    expect(screen.getByText('API keys form')).toBeVisible();
    view.unmount();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    setup();
    fireEvent.click(sectionNav().getByRole('link', { name: 'Pipeline' }));
    expect(screen.getByText('Pipeline form')).toBeVisible();
  });
});
