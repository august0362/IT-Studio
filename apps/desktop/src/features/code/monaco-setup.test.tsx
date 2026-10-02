import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { resolveTheme } from '../../theme/catalog';

const config = vi.fn<(options: { readonly monaco: unknown }) => void>();
const defineTheme = vi.fn<(name: string, theme: unknown) => void>();
const setTheme = vi.fn<(name: string) => void>();
vi.mock('@monaco-editor/react', () => ({ loader: { config } }));
vi.mock('../../../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker', () => ({
  default: class MockEditorWorker {
    readonly isWorkerMock = true;
  },
}));
vi.mock('monaco-editor', () => ({
  editor: {
    defineTheme: (name: string, theme: unknown) => {
      defineTheme(name, theme);
    },
    setTheme: (name: string) => {
      setTheme(name);
    },
  },
}));

describe('monaco setup', () => {
  beforeEach(() => {
    config.mockClear();
    defineTheme.mockClear();
    setTheme.mockClear();
  });
  it('uses bundled Monaco and never configures a CDN path', async () => {
    const { setupMonaco } = await import('./monaco-setup');
    config.mockClear();
    defineTheme.mockClear();
    setupMonaco();
    expect(config).toHaveBeenCalledTimes(1);
    const options = config.mock.calls[0]?.[0];
    expect(options?.monaco).toBeDefined();
    expect(options).not.toHaveProperty('paths');
    expect(defineTheme).toHaveBeenCalledTimes(1);
    expect(defineTheme.mock.calls[0]?.[0]).toBe('itstudio-active');
    expect(globalThis.MonacoEnvironment?.getWorker?.('editor', 'editor')).toBeDefined();
  });

  it('redefines and applies the Monaco theme when root theme attributes change', async () => {
    const { setupMonaco } = await import('./monaco-setup');
    setupMonaco();
    defineTheme.mockClear();
    setTheme.mockClear();

    document.documentElement.dataset.theme = 'midnight-focus';
    document.documentElement.dataset.mode = 'dark';

    await waitFor(() => {
      expect(defineTheme).toHaveBeenCalledTimes(1);
      expect(setTheme).toHaveBeenCalledWith('itstudio-active');
    });
    const expected = resolveTheme('midnight-focus', 'dark', true).tokens;
    expect(defineTheme.mock.calls[0]?.[1]).toMatchObject({
      base: 'vs-dark',
      colors: { 'editor.background': expected.bg },
    });
  });
});
