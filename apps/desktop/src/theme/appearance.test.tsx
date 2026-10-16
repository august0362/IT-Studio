import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Script } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAppearance, appearanceSchema, appearanceTokens, readAppearance, writeThemeCache } from './appearance';
import { applyTheme } from './apply-theme';
import { resolveTheme, themeCatalog } from './catalog';

function contrast(first: string, second: string): number {
  const luminance = (hex: string) => {
    const values = [1, 3, 5].map((offset) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return (values[0] ?? 0) * 0.2126 + (values[1] ?? 0) * 0.7152 + (values[2] ?? 0) * 0.0722;
  };
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  for (const key of ['theme', 'mode', 'density', 'motion', 'font-scale'])
    document.documentElement.removeAttribute('data-' + key);
  vi.restoreAllMocks();
});

describe('UX-05 appearance', () => {
  it('ships intact Vietnamese diacritics for appearance labels', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../i18n/vi.json'), 'utf8');
    expect(source).toContain('Không gian của bạn');
    expect(source).toContain('Mật độ');
    expect(source).toContain('Chuyển động');
  });
  it('checks every text, control, status, chart and accent pair in every theme and mode', () => {
    for (const theme of themeCatalog.themes) {
      for (const mode of ['light', 'dark'] as const) {
        for (const accent of ['theme', 'ocean', 'grove', 'ember', 'alternate'] as const) {
          const tokens = appearanceTokens(theme[mode], accent);
          for (const background of ['bg', 'surface', 'surfaceAlt'] as const) {
            for (const foreground of [
              'text',
              'textMuted',
              'primary',
              'accent',
              'success',
              'warning',
              'danger',
              'info',
              'border',
              'focusRing',
            ] as const) {
              const minimum =
                foreground === 'text' ? 7 : foreground === 'border' || foreground === 'focusRing' ? 3 : 4.5;
              expect(
                contrast(tokens[foreground], tokens[background]),
                `${theme.id}/${mode}/${accent}: ${foreground}/${background}`,
              ).toBeGreaterThanOrEqual(minimum);
            }
            for (const color of tokens.chart) expect(contrast(color, tokens[background])).toBeGreaterThanOrEqual(3);
          }
          expect(contrast(tokens.primaryFg, tokens.primary)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(tokens.primaryFg, tokens.primaryHover)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('retains every legacy selection without a lossy migration', () => {
    const ids = [
      'arctic-focus',
      'midnight-focus',
      'deep-forest',
      'harbor',
      'royal-ink',
      'spring-grove',
      'berry-dusk',
      'espresso',
      'blush-lavender',
      'vintage-dawn',
      'sherbet',
      'peach-cream',
      'candy-floss',
      'lemon-sky',
      'honey-sand',
      'autumn-ember',
      'summer-meadow',
      'winter-stone',
      'neon-gold',
      'neon-cyan',
      'neon-violet',
    ];
    for (const id of ids) {
      expect(resolveTheme(id, 'light', false).definition.id).toBe(id);
      expect(resolveTheme(id, 'dark', false).definition.id).toBe(id);
    }
  });

  it('merges preferences with existing cache fields, validates corrupt values, and reports unavailable storage', () => {
    writeThemeCache({ themeId: 'harbor', mode: 'dark', future: true });
    writeThemeCache({ density: 'compact', fontScale: 'large', motion: 'reduced', accent: 'grove' });
    writeThemeCache({ mode: 'light' });
    expect(readAppearance()).toEqual({ density: 'compact', fontScale: 'large', motion: 'reduced', accent: 'grove' });
    expect(localStorage.getItem('itstudio.theme')).toContain('future');
    localStorage.setItem(
      'itstudio.theme',
      JSON.stringify({ density: 'bad', fontScale: 8, motion: null, accent: 'invalid' }),
    );
    expect(readAppearance()).toEqual(appearanceSchema.parse({}));
    localStorage.setItem('itstudio.theme', 'null');
    expect(readAppearance()).toEqual(appearanceSchema.parse({}));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    expect(writeThemeCache({ motion: 'reduced' })).toBe(false);
  });

  it('applies preferences and restores theme defaults when the accent override is cleared', () => {
    const tokens = resolveTheme('harbor', 'dark', false).tokens;
    writeThemeCache({ density: 'compact', fontScale: 'large', motion: 'reduced', accent: 'ocean' });
    applyTheme('harbor', 'dark', tokens);
    expect(document.documentElement.dataset.density).toBe('compact');
    expect(document.documentElement.dataset.motion).toBe('reduced');
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.125');
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe(tokens.info);
    writeThemeCache({ accent: 'theme' });
    applyTheme('harbor', 'dark', tokens);
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe(tokens.primary);
    applyAppearance(appearanceSchema.parse({}));
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1');
  });

  it('boot script ignores malformed fields and inherited object keys in corrupt cache', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../../index.html'), 'utf8');
    const source = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1];
    if (source === undefined) throw new Error('Missing boot script');
    for (const accent of ['__proto__', 'toString', {}, null, 'unknown']) {
      writeThemeCache({ themeId: 'harbor', mode: 'light', accent, density: false, fontScale: 50, motion: [] });
      new Script(source).runInNewContext({ document, localStorage, matchMedia: () => ({ matches: false }) });
      expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe(
        resolveTheme('harbor', 'light', false).tokens.primary,
      );
      expect(document.documentElement.dataset.density).toBe('comfortable');
      expect(document.documentElement.dataset.motion).toBe('system');
      expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1');
    }
  });

  it('boot script matches runtime for every catalog entry, mode and accent including preferences', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../../index.html'), 'utf8');
    const source = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1];
    if (source === undefined) throw new Error('Missing boot script');
    const script = new Script(source);
    for (const theme of themeCatalog.themes) {
      for (const mode of ['light', 'dark'] as const) {
        for (const accent of ['theme', 'ocean', 'grove', 'ember', 'alternate'] as const) {
          writeThemeCache({
            themeId: theme.id,
            mode,
            accent,
            density: 'compact',
            fontScale: 'large',
            motion: 'reduced',
          });
          document.documentElement.removeAttribute('style');
          script.runInNewContext({ document, localStorage, matchMedia: () => ({ matches: false }) });
          expect(document.documentElement.dataset.theme).toBe(theme.id);
          expect(document.documentElement.dataset.mode).toBe(mode);
          expect(document.documentElement.dataset.density).toBe('compact');
          expect(document.documentElement.dataset.motion).toBe('reduced');
          expect(document.documentElement.dataset.fontScale).toBe('large');
          const bootStyle = document.documentElement.style.cssText;
          document.documentElement.removeAttribute('style');
          applyTheme(theme.id, mode, theme[mode]);
          const runtimeStyle = document.documentElement.style;
          const boot = document.createElement('div');
          boot.style.cssText = bootStyle;
          for (const property of Array.from(runtimeStyle))
            expect(boot.style.getPropertyValue(property), `${theme.id}/${mode}/${accent}/${property}`).toBe(
              runtimeStyle.getPropertyValue(property),
            );
          expect(document.documentElement.dataset.density).toBe('compact');
          expect(document.documentElement.dataset.motion).toBe('reduced');
        }
      }
    }
  });
});
