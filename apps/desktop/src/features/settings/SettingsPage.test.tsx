import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';
import { searchSettings } from './settings-sections';
import { AppShell } from '../../shell/AppShell';

// Keep navigation tests independent of the forms' RPC data and validation.
vi.mock('./api-keys/ApiKeysPage', () => ({ ApiKeysPage: () => <p>API keys form</p> }));
vi.mock('./router/RouterSettingsPage', () => ({ RouterSettingsPage: () => <p>Router form</p> }));
vi.mock('./pipeline/PipelineSettingsPage', () => ({
  PipelineSettingsPage: () => (
    <div>
      <p>Pipeline form</p>
      <label>
        Auto-answer clarifying questions
        <input id="pipeline-auto-clarify" type="checkbox" />
      </label>
    </div>
  ),
}));
vi.mock('./budget/BudgetSettingsPage', () => ({ BudgetSettingsPage: () => <p>Budget form</p> }));
vi.mock('./pricing/PricingSettingsPage', () => ({
  PricingSettingsPage: ({ projectActive }: { readonly projectActive: boolean }) => (
    <p>Pricing form: {String(projectActive)}</p>
  ),
}));
vi.mock('./fx/FxSettingsPage', () => ({ FxSettingsPage: () => <p>FX form</p> }));
vi.mock('./images/ImagesSettingsPage', () => ({ ImagesSettingsPage: () => <p>Images form</p> }));
vi.mock('../webchat/ResolvedWebChatSettingsPage', () => ({
  ResolvedWebChatSettingsPage: () => (
    <div>
      <p>Web chat form</p>
      <input id="webchat-link-name" aria-label="Name" />
      <input id="webchat-link-url" aria-label="URL" />
      <input id="webchat-link-enabled" aria-label="Enabled" type="checkbox" />
    </div>
  ),
}));
vi.mock('./vscode/VSCodeSettingsPage', () => ({ VSCodeSettingsPage: () => <p>VS Code form</p> }));
vi.mock('./theme/ThemePage', () => ({ ThemePage: () => <p>Theme form</p> }));

const clients: RpcClient[] = [];
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
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
          ? { activeProjectId: null, ui: { themeId: 'arctic-focus', mode: 'system', locale: 'en' } }
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Search settings' }), { target: { value: query } });
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
    const search = screen.getByRole('combobox', { name: 'Search settings' });
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

describe('OWNER-FB3 Settings suggestions', () => {
  it('TC-OWNER-FB3-008 first character shows up to eight ranked suggestions, sections before fields', () => {
    setup();
    const input = screen.getByRole('combobox', { name: 'Search settings' });
    fireEvent.change(input, { target: { value: 'p' } });
    const list = screen.getByRole('listbox');
    const options = within(list).getAllByRole('option');
    expect(options).toHaveLength(8);
    expect(options[0]).toHaveTextContent('Pipeline');
    expect(options[1]).toHaveTextContent('Pricing');
    expect(list.querySelector('mark')).toHaveTextContent(/p/i);
    expect(searchSettings('p').some((entry) => entry.id === 'pipeline-auto-clarify')).toBe(true);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });
  it('TC-OWNER-FB3-009 Vietnamese matching ignores case and diacritics', async () => {
    expect(searchSettings('NGAN SACH')[0]?.section).toBe('settings-budget');
    expect(searchSettings('ngon ngu').some((entry) => entry.id === 'theme-language')).toBe(true);
    expect(searchSettings('che do').some((entry) => entry.id === 'theme-mode')).toBe(true);
    setup();
    await act(() => i18n.changeLanguage('vi'));
    fireEvent.change(screen.getByRole('combobox', { name: i18n.t('settings.search') }), {
      target: { value: 'ngan sach' },
    });
    expect(screen.getByRole('listbox').querySelector('mark')).toHaveTextContent('Ngân sách');
  });
  it.each([
    ['Name', 'webchat-link-name'],
    ['URL', 'webchat-link-url'],
    ['Bật', 'webchat-link-enabled'],
  ])('TC-OWNER-FB3-018 %s suggestions focus the individual Web Chat control', (query, id) => {
    setup();
    const input = screen.getByRole('combobox', { name: 'Search settings' });
    fireEvent.change(input, { target: { value: query } });
    const index = searchSettings(query).findIndex((entry) => entry.id === id);
    expect(index).toBeGreaterThanOrEqual(0);
    const option = within(screen.getByRole('listbox')).getAllByRole('option')[index];
    if (option === undefined) throw new Error('Missing field suggestion');
    fireEvent.click(option);
    expect(window.location.hash).toBe('#settings-web-chat');
    expect(document.getElementById(id)).toHaveFocus();
  });
  it('TC-OWNER-FB3-010 keyboard and mouse selection navigate and focus the exact setting', async () => {
    setup();
    const input = screen.getByRole('combobox', { name: 'Search settings' });
    fireEvent.change(input, { target: { value: 'auto-answer' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(window.location.hash).toBe('#settings-pipeline');
    expect(await screen.findByRole('checkbox', { name: 'Auto-answer clarifying questions' })).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Primary theme' } });
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option'));
    expect(window.location.hash).toBe('#settings-theme');
  });
});
