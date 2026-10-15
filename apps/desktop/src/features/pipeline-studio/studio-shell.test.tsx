import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { AppShell } from '../../shell/AppShell';
import type * as StudioExports from './index';
import { graphDimensions, mountStudio } from './test-support';

const flag = vi.hoisted(() => ({ enabled: true }));
vi.mock('./index', async (original) => ({
  ...(await original<typeof StudioExports>()),
  get PIPELINE_STUDIO_ENABLED() {
    return flag.enabled;
  },
}));
vi.mock('../code/monaco-setup', () => ({}));
vi.mock('@monaco-editor/react', () => ({ DiffEditor: () => null }));
const disposers: (() => void)[] = [];
beforeAll(async () => {
  await import('./index');
  // The index exports React.lazy; load its target before timing shell interactions.
  await import('./PipelineStudioPage');
}, 20000);
beforeEach(() => {
  graphDimensions();
  void i18n.changeLanguage('en');
  window.history.replaceState(null, '', '#settings-api-keys');
  flag.enabled = true;
});
afterEach(() => {
  cleanup();
  for (const dispose of disposers.splice(0)) dispose();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, '', '#settings-api-keys');
});
function setup() {
  const view = mountStudio(<AppShell />);
  disposers.push(view.dispose);
  return view;
}
describe('PSTUDIO-02 shell integration', () => {
  it('Settings button enters #pipeline-studio with no MainNav, project tabs or status bar; Back returns', async () => {
    const view = setup();
    await screen.findByRole('tab', { name: 'Project One' }, { timeout: 10000 });
    fireEvent.click(screen.getByRole('button', { name: 'Pipeline Studio' }));
    expect(await screen.findByRole('region', { name: 'Pipeline Studio' }, { timeout: 10000 })).toBeInTheDocument();
    expect(window.location.hash).toBe('#pipeline-studio');
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(view.container.querySelector('footer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '← Back' }));
    expect(await screen.findByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#settings-api-keys');
  }, 15000);
  it('direct hash entry works and Escape returns to the default route', async () => {
    window.history.replaceState(null, '', '#pipeline-studio');
    setup();
    await screen.findByRole('region', { name: 'Pipeline Studio' }, { timeout: 10000 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByRole('heading', { name: 'API keys' })).toBeVisible();
  }, 15000);
  it('flag false hides the Settings button and hash falls back to default', async () => {
    flag.enabled = false;
    window.history.replaceState(null, '', '#pipeline-studio');
    setup();
    expect(await screen.findByRole('heading', { name: 'API keys' })).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Pipeline Studio' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Pipeline Studio' })).not.toBeInTheDocument();
  });
});
