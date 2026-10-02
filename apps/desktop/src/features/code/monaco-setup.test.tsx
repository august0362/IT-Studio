import { beforeEach, describe, expect, it, vi } from 'vitest';

const config = vi.fn<(options: { readonly monaco: unknown }) => void>();
const defineTheme = vi.fn<(name: string, theme: unknown) => void>();
vi.mock('@monaco-editor/react', () => ({ loader: { config } }));
vi.mock('monaco-editor', () => ({
  editor: {
    defineTheme: (name: string, theme: unknown) => {
      defineTheme(name, theme);
    },
  },
}));

describe('monaco setup', () => {
  beforeEach(() => {
    config.mockClear();
    defineTheme.mockClear();
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
  });
});
