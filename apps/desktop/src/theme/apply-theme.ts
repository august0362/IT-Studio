import type { ThemeTokens } from '@itstudio/schemas';

function kebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

export function applyTheme(themeId: string, mode: 'light' | 'dark', tokens: ThemeTokens): void {
  const root = document.documentElement;
  const semanticKeys = [
    'bg',
    'surface',
    'surfaceAlt',
    'border',
    'text',
    'textMuted',
    'primary',
    'primaryFg',
    'primaryHover',
    'accent',
    'focusRing',
    'success',
    'warning',
    'danger',
    'info',
  ] as const;
  for (const key of semanticKeys) {
    root.style.setProperty(`--color-${kebabCase(key)}`, tokens[key]);
  }
  const effects = {
    glow: tokens.glow ?? tokens.primary,
    surfaceGlass: tokens.surfaceGlass ?? tokens.surface,
    borderGlow: tokens.borderGlow ?? tokens.border,
    gradientStart: tokens.gradientStart ?? tokens.bg,
    gradientEnd: tokens.gradientEnd ?? tokens.surfaceAlt,
  };
  for (const [key, value] of Object.entries(effects)) {
    root.style.setProperty(`--color-${kebabCase(key)}`, value);
  }
  tokens.chart.forEach((color, index) => {
    root.style.setProperty(`--color-chart-${(index + 1).toString()}`, color);
  });
  for (let index = tokens.chart.length; index < 6; index += 1) {
    root.style.removeProperty(`--color-chart-${(index + 1).toString()}`);
  }
  root.dataset.theme = themeId;
  root.dataset.mode = mode;
}

export function enableThemeTransitions(): void {
  const style = document.createElement('style');
  style.textContent =
    '@media (prefers-reduced-motion: no-preference) { :root { transition: background-color 150ms, color 150ms, border-color 150ms; } }';
  document.head.append(style);
}
