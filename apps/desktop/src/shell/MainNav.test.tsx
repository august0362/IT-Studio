import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import { mountProcesses } from '../features/processes/test-support';
import { writeThemeCache } from '../theme/appearance';
import { MainNav } from './MainNav';

const disposers: (() => void)[] = [];
beforeEach(() => {
  void i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  disposers.splice(0).forEach((dispose) => {
    dispose();
  });
  vi.restoreAllMocks();
  localStorage.clear();
});

function mount() {
  const navigate = vi.fn();
  const view = mountProcesses(<MainNav route="chat" navigate={navigate} projectName="Vườn ý tưởng" />, []);
  disposers.push(view.dispose);
  return { ...view, navigate };
}

describe('UX-06 sidebar', () => {
  it('keeps named links, project context and current page when collapsed, and restores the preference after remount', () => {
    writeThemeCache({ themeId: 'harbor', motion: 'reduced' });
    const first = mount();
    expect(screen.getByText('Vườn ý tưởng')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('navigation')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Knowledge' })).toHaveAttribute('title', 'Knowledge');
    fireEvent.click(screen.getByRole('link', { name: 'Knowledge' }));
    expect(first.navigate).toHaveBeenCalledWith('knowledge');
    writeThemeCache({ mode: 'dark' });
    first.unmount();
    const second = mount();
    expect(screen.getByRole('navigation')).toHaveAttribute('data-collapsed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    expect(screen.getByRole('navigation')).toHaveAttribute('data-collapsed', 'false');
    second.unmount();
    mount();
    expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(localStorage.getItem('itstudio.theme') ?? '{}')).toMatchObject({
      themeId: 'harbor',
      mode: 'dark',
      motion: 'reduced',
      sidebarCollapsed: false,
    });
  });

  it.each(['not json', 'null', '{"sidebarCollapsed":"true"}'])(
    'defaults to expanded for corrupt storage: %s',
    (cache) => {
      localStorage.setItem('itstudio.theme', cache);
      mount();
      expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toHaveAttribute('aria-expanded', 'true');
    },
  );

  it('still collapses and navigates when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Unavailable');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Unavailable');
    });
    const view = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    expect(screen.getByRole('navigation')).toHaveAttribute('data-collapsed', 'true');
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(view.navigate).toHaveBeenCalledWith('settings');
  });
});
