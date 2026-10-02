import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { applyTheme } from './apply-theme';
import { resolveTheme, themeCatalog } from './catalog';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.mode;
});

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

function findTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? findTsxFiles(path) : entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('theme catalog', () => {
  it('recomputes WCAG thresholds for all 36 theme and mode pairs', () => {
    expect(themeCatalog.themes).toHaveLength(18);
    for (const theme of themeCatalog.themes) {
      for (const tokens of [theme.light, theme.dark]) {
        expect(contrast(tokens.text, tokens.bg)).toBeGreaterThanOrEqual(7);
        expect(contrast(tokens.text, tokens.surface)).toBeGreaterThanOrEqual(7);
        expect(contrast(tokens.text, tokens.surfaceAlt)).toBeGreaterThanOrEqual(7);
        expect(contrast(tokens.textMuted, tokens.surfaceAlt)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens.primaryFg, tokens.primary)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens.accent, tokens.bg)).toBeGreaterThanOrEqual(3);
        expect(contrast(tokens.focusRing, tokens.bg)).toBeGreaterThanOrEqual(3);
        for (const color of [tokens.success, tokens.warning, tokens.danger, tokens.info]) {
          expect(contrast(color, tokens.surface)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('uses catalog defaults for unknown themes and resolves system mode', () => {
    expect(resolveTheme('missing', 'light', true).definition.id).toBe(themeCatalog.defaultLight);
    expect(resolveTheme('missing', 'dark', false).definition.id).toBe(themeCatalog.defaultDark);
    expect(resolveTheme('arctic-focus', 'system', true).mode).toBe('dark');
  });

  it('applies semantic variables, chart slots and document attributes', () => {
    const tokens = themeCatalog.themes[0]?.dark;
    if (tokens === undefined) throw new Error('Theme catalog missing default theme');
    applyTheme('midnight-focus', 'dark', tokens);
    expect(document.documentElement.style.getPropertyValue('--color-surface-alt')).toBe(tokens.surfaceAlt);
    expect(document.documentElement.style.getPropertyValue('--color-chart-1')).toBe(tokens.chart[0]);
    expect(document.documentElement.dataset.theme).toBe('midnight-focus');
    expect(document.documentElement.dataset.mode).toBe('dark');
  });

  it('contains no raw hex literals in desktop TSX files', () => {
    const hexPattern = new RegExp('#' + '[0-9a-fA-F]' + '{3,6}');
    const files = findTsxFiles(resolve(import.meta.dirname, '..'));
    const offending = files.filter((file) => hexPattern.test(readFileSync(file, 'utf8')));
    expect(offending).toEqual([]);
  });

  it('rejects Tailwind palette color classes in JSX string literals', async () => {
    const eslint = new ESLint();
    const fixture = '<div className="bg-' + 'blue-500" />';
    const results = await eslint.lintText(fixture, { filePath: resolve(import.meta.dirname, 'theme.test.tsx') });
    expect(results[0]?.messages.some((message) => message.message.includes('semantic theme color tokens'))).toBe(true);
  }, 20_000);
});
