import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Script } from 'node:vm';
import { ESLint } from 'eslint';
import { readFileSync as readFile } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { applyTheme } from './apply-theme';
import { resolveTheme, themeCatalog } from './catalog';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.mode;
  localStorage.clear();
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

function glassSurface(foreground: string, background: string): string {
  return (
    '#' +
    [1, 3, 5]
      .map((start) => {
        const channel =
          Number.parseInt(foreground.slice(start, start + 2), 16) * 0.96 +
          Number.parseInt(background.slice(start, start + 2), 16) * 0.04;
        return Math.round(channel).toString(16).padStart(2, '0');
      })
      .join('')
  );
}

function findTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? findTsxFiles(path) : entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('theme catalog', () => {
  it('TC-M4-014 keeps English and Vietnamese keys in parity and drops the unused budget key', () => {
    const english = JSON.parse(readFile(resolve(import.meta.dirname, '../i18n/en.json'), 'utf8')) as unknown;
    const vietnamese = JSON.parse(readFile(resolve(import.meta.dirname, '../i18n/vi.json'), 'utf8')) as unknown;
    const keys = (value: unknown, prefix = ''): string[] => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix];
      return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
    };
    expect(keys(english).sort()).toEqual(keys(vietnamese).sort());
    expect(keys(english)).not.toContain('cost.budgetContractUnavailable');
  });

  it('TC-M4-034 formats money only through the shared Money component', () => {
    const files = findTsxFiles(resolve(import.meta.dirname, '../features'));
    const formatters = files.flatMap((file) => {
      const source = readFile(file, 'utf8');
      return [...source.matchAll(/(?:\.toFixed\s*\(|new Intl\.NumberFormat\s*\()/gu)].map((match) => ({
        file,
        text: source.slice(Math.max(0, match.index - 80), match.index + 160),
      }));
    });
    expect(
      formatters.every(({ text }) => /marginPercent|\.score\.toFixed|query\.data\.usdToVnd|delta\.percent/u.test(text)),
    ).toBe(true);
  });

  it('TC-M4-002 recomputes WCAG thresholds for all 42 theme and mode pairs, including glow surfaces', () => {
    expect(themeCatalog.themes).toHaveLength(21);
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
        const glass = tokens.surfaceGlass ?? tokens.surface;
        for (const background of [
          glass,
          glassSurface(glass, tokens.bg),
          glassSurface(glass, tokens.surfaceAlt),
          tokens.gradientStart ?? tokens.bg,
          tokens.gradientEnd ?? tokens.surfaceAlt,
        ]) {
          expect(contrast(tokens.text, background)).toBeGreaterThanOrEqual(7);
          expect(contrast(tokens.textMuted, background)).toBeGreaterThanOrEqual(4.5);
        }
        if (tokens.borderGlow !== undefined) {
          expect(contrast(tokens.borderGlow, tokens.surfaceAlt)).toBeGreaterThanOrEqual(3);
          expect(contrast(tokens.focusRing, tokens.surfaceAlt)).toBeGreaterThanOrEqual(3);
          for (const color of [tokens.success, tokens.warning, tokens.danger, tokens.info]) {
            expect(contrast(color, tokens.surfaceAlt)).toBeGreaterThanOrEqual(4.5);
          }
        }
        expect(contrast(tokens.primaryFg, tokens.primaryHover)).toBeGreaterThanOrEqual(4.5);
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

  it('resets optional effect colors to safe fallbacks when switching to a legacy theme', () => {
    const neon = resolveTheme('neon-gold', 'dark', false).tokens;
    const legacy = resolveTheme('arctic-focus', 'light', false).tokens;
    applyTheme('neon-gold', 'dark', neon);
    expect(document.documentElement.style.getPropertyValue('--color-glow')).toBe(neon.glow);
    applyTheme('arctic-focus', 'light', legacy);
    expect(document.documentElement.style.getPropertyValue('--color-glow')).toBe(legacy.primary);
    expect(document.documentElement.style.getPropertyValue('--color-surface-glass')).toBe(legacy.surface);
    expect(document.documentElement.style.getPropertyValue('--color-border-glow')).toBe(legacy.border);
    expect(document.documentElement.style.getPropertyValue('--color-gradient-start')).toBe(legacy.bg);
    expect(document.documentElement.style.getPropertyValue('--color-gradient-end')).toBe(legacy.surfaceAlt);
  });

  it('ships three dark-native glow palettes with usable light counterparts', () => {
    expect(themeCatalog.defaultDark).toBe('neon-gold');
    expect(themeCatalog.defaultLight).toBe('arctic-focus');
    for (const id of ['neon-gold', 'neon-cyan', 'neon-violet']) {
      const theme = themeCatalog.themes.find((entry) => entry.id === id);
      if (theme === undefined) throw new Error(`Missing theme ${id}`);
      expect(theme.nativeMode).toBe('dark');
      expect(theme.light.glow).toBeDefined();
      expect(theme.dark.glow).toBeDefined();
      const palette = readFileSync(resolve(import.meta.dirname, '../../../../', theme.source));
      expect(Array.from(palette.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(palette.readUInt32BE(16)).toBe(128);
      expect(palette.readUInt32BE(20)).toBe(64);
    }
  });

  it('applies the same default and cached tokens before React starts', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../../index.html'), 'utf8');
    const inline = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1];
    if (inline === undefined) throw new Error('Missing startup theme script');
    const run = (): void => {
      new Script(inline).runInNewContext({ document, localStorage, matchMedia: () => ({ matches: true }) });
    };
    run();
    expect(document.documentElement.dataset.theme).toBe('neon-gold');
    const neon = resolveTheme('neon-gold', 'dark', false).tokens;
    expect(document.documentElement.style.getPropertyValue('--color-border-glow')).toBe(neon.borderGlow);
    localStorage.setItem('itstudio.theme', JSON.stringify({ themeId: 'midnight-focus', mode: 'dark' }));
    run();
    const cached = resolveTheme('midnight-focus', 'dark', false).tokens;
    expect(document.documentElement.dataset.theme).toBe('midnight-focus');
    expect(document.documentElement.style.getPropertyValue('--color-glow')).toBe(cached.primary);
    expect(document.documentElement.style.getPropertyValue('--color-surface-glass')).toBe(cached.surface);
    localStorage.setItem('itstudio.theme', 'invalid json');
    run();
    expect(document.documentElement.dataset.theme).toBe('neon-gold');
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
  }, 60_000);
});
