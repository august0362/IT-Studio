import { z } from 'zod';
import type { ThemeTokens } from '@itstudio/schemas';

export const appearanceSchema = z.object({
  accent: z.enum(['theme', 'ocean', 'grove', 'ember', 'alternate']).catch('theme'),
  density: z.enum(['comfortable', 'compact']).catch('comfortable'),
  fontScale: z.enum(['small', 'default', 'large']).catch('default'),
  motion: z.enum(['full', 'reduced', 'system']).catch('system'),
});
export type Appearance = z.infer<typeof appearanceSchema>;
export const APPEARANCE_EVENT = 'itstudio-appearance';

export function readThemeCache(): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('itstudio.theme') ?? '{}');
    return z.record(z.string(), z.unknown()).parse(value);
  } catch {
    // Startup storage is optional; validated defaults remain usable.
    return {};
  }
}

export function readAppearance(): Appearance {
  return appearanceSchema.parse(readThemeCache());
}

/** Merge additive local preferences so settings synchronization never erases them. */
export function writeThemeCache(patch: Readonly<Record<string, unknown>>): boolean {
  try {
    localStorage.setItem('itstudio.theme', JSON.stringify({ ...readThemeCache(), ...patch }));
    return true;
  } catch {
    return false;
  }
}

export function appearanceTokens(tokens: ThemeTokens, accent: Appearance['accent']): ThemeTokens {
  if (accent === 'theme') return tokens;
  const primary = { ocean: tokens.info, grove: tokens.success, ember: tokens.warning, alternate: tokens.accent }[
    accent
  ];
  // The generator enforces 4.5:1 on every surface for these options. A dark
  // variant uses its own background as the label; a light variant uses white.
  const primaryFg = tokens.primaryFg;
  return {
    ...tokens,
    primary,
    primaryHover: primary,
    primaryFg,
    focusRing: primary,
    glow: primary,
    borderGlow: primary,
  };
}

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  root.dataset.density = appearance.density;
  root.dataset.motion = appearance.motion;
  root.dataset.fontScale = appearance.fontScale;
  root.style.setProperty('--ui-scale', { small: '0.9375', default: '1', large: '1.125' }[appearance.fontScale]);
}
