import type {
  ImageAsset,
  ImageGenerationRequest,
  ImageMimeType,
  ImageProviderId,
  ImageSize,
  ThemeCatalog,
  ThemeDefinition,
  ThemeTokens,
} from '@itstudio/schemas';
import {
  imageAssetIdSchema,
  microUsdSchema,
  projectIdSchema,
  toolCallIdSchema,
  isoDateTimeSchema,
  themeIdSchema,
  hexColorSchema,
  z,
} from './common.js';
import { generateImageArgsSchema } from './chat.js';
export const imageProviderIdSchema = z.enum([
  'openai_dalle3',
  'flux_together',
  'flux_replicate',
  'midjourney_proxy',
]) satisfies z.ZodType<ImageProviderId>;
export const imageSizeSchema = z.enum(['1024x1024', '1792x1024', '1024x1792']) satisfies z.ZodType<ImageSize>;
export const imageMimeTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp']) satisfies z.ZodType<ImageMimeType>;
export const imageGenerationRequestSchema = z
  .object({ projectId: projectIdSchema, args: generateImageArgsSchema, toolCallId: toolCallIdSchema.exactOptional() })
  .readonly() satisfies z.ZodType<ImageGenerationRequest>;
export const imageAssetSchema = z
  .object({
    id: imageAssetIdSchema,
    projectId: projectIdSchema,
    provider: imageProviderIdSchema,
    prompt: z.string(),
    revisedPrompt: z.string().exactOptional(),
    size: imageSizeSchema,
    mimeType: imageMimeTypeSchema,
    localPath: z.string(),
    cost: microUsdSchema,
    createdAt: isoDateTimeSchema,
  })
  .readonly() satisfies z.ZodType<ImageAsset>;
export const themeTokensSchema = z
  .object({
    bg: hexColorSchema,
    surface: hexColorSchema,
    surfaceAlt: hexColorSchema,
    border: hexColorSchema,
    text: hexColorSchema,
    textMuted: hexColorSchema,
    primary: hexColorSchema,
    primaryFg: hexColorSchema,
    primaryHover: hexColorSchema,
    accent: hexColorSchema,
    focusRing: hexColorSchema,
    success: hexColorSchema,
    warning: hexColorSchema,
    danger: hexColorSchema,
    info: hexColorSchema,
    chart: z.array(hexColorSchema).max(6).readonly(),
    contrast: z.record(z.string(), z.number()).readonly(),
  })
  .readonly() satisfies z.ZodType<ThemeTokens>;
export const themeDefinitionSchema = z
  .object({
    id: themeIdSchema,
    name: z.string(),
    source: z.string(),
    palette: z.array(hexColorSchema).length(4).readonly(),
    nativeMode: z.enum(['light', 'dark']),
    mood: z.string(),
    psychology: z.string(),
    recommendedFor: z.array(z.string()).readonly(),
    light: themeTokensSchema,
    dark: themeTokensSchema,
  })
  .readonly() satisfies z.ZodType<ThemeDefinition>;
export const themeCatalogSchema = z
  .object({
    version: z.literal(1),
    generatedBy: z.string(),
    defaultLight: themeIdSchema,
    defaultDark: themeIdSchema,
    themes: z.array(themeDefinitionSchema).readonly(),
  })
  .readonly() satisfies z.ZodType<ThemeCatalog>;
