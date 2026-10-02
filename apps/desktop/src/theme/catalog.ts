import { z } from 'zod';
import themeJson from '../../../../config/themes.json';
import {
  ThemeMode,
  type HexColor,
  type ThemeCatalog,
  type ThemeDefinition,
  type ThemeId,
  type ThemeMode as ThemeModeType,
  type ThemeTokens,
} from '@itstudio/schemas';

const color = z.custom<HexColor>(
  (value): value is HexColor => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value),
);
const themeId = z.custom<ThemeId>(
  (value): value is ThemeId => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
);
const tokens = z
  .object({
    bg: color,
    surface: color,
    surfaceAlt: color,
    border: color,
    text: color,
    textMuted: color,
    primary: color,
    primaryFg: color,
    primaryHover: color,
    accent: color,
    focusRing: color,
    success: color,
    warning: color,
    danger: color,
    info: color,
    chart: z.array(color).max(6),
    contrast: z.record(z.string(), z.number()),
  })
  .readonly() satisfies z.ZodType<ThemeTokens>;
const theme = z
  .object({
    id: themeId,
    name: z.string(),
    source: z.string(),
    palette: z.array(color).length(4),
    nativeMode: z.enum(['light', 'dark']),
    mood: z.string(),
    psychology: z.string(),
    recommendedFor: z.array(z.string()),
    light: tokens,
    dark: tokens,
  })
  .readonly() satisfies z.ZodType<ThemeDefinition>;
const catalogSchema = z
  .object({
    version: z.literal(1),
    generatedBy: z.string(),
    defaultLight: themeId,
    defaultDark: themeId,
    themes: z.array(theme).length(18),
  })
  .readonly() satisfies z.ZodType<ThemeCatalog>;

/** The catalog is a bundled build asset; validate it once when the UI module loads. */
export const themeCatalog = catalogSchema.parse(themeJson);

export function resolveTheme(themeId: string, mode: ThemeModeType, prefersDark: boolean) {
  const selected = themeCatalog.themes.find((item) => item.id === themeId);
  const activeMode = mode === ThemeMode.SYSTEM ? (prefersDark ? 'dark' : 'light') : mode;
  const fallbackId = activeMode === 'dark' ? themeCatalog.defaultDark : themeCatalog.defaultLight;
  const definition = selected ?? themeCatalog.themes.find((item) => item.id === fallbackId) ?? themeCatalog.themes[0];
  if (definition === undefined) throw new Error('Theme catalog is empty');
  return { definition, mode: activeMode, tokens: definition[activeMode] };
}
