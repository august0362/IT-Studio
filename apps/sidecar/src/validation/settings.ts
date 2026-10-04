import type {
  AppSettings,
  BudgetSettings,
  FxSettings,
  ImageSettings,
  PipelineSettings,
  PricingSettings,
  RagSettings,
  SettingsPatch,
  UiSettings,
  VSCodeSettings,
  WebChatSettings,
  WebChatLinkId,
} from '@itstudio/schemas';
import { projectIdSchema, modelKeySchema, themeIdSchema, z } from './common.js';
import { routerConfigSchema, ladderEntrySchema, circuitBreakerConfigSchema } from './router.js';
import { commandSpecSchema } from './worker.js';
import { embeddingConfigSchema, chunkingConfigSchema } from './rag.js';
import { imageProviderIdSchema } from './image.js';
import { roleAssignmentSchema } from './pipeline.js';
import { WebChatBrowser } from '@itstudio/schemas';
import { validateWebChatSettings } from '../domain/web-chat.js';
const webChatBrowserSchema = z.enum([
  WebChatBrowser.DEFAULT,
  WebChatBrowser.COCCOC,
  WebChatBrowser.CHROME,
  WebChatBrowser.EDGE,
  WebChatBrowser.FIREFOX,
  WebChatBrowser.CUSTOM,
]);
export const webChatSettingsSchema = z
  .object({
    browser: webChatBrowserSchema,
    customBrowserPath: z.string().nullable(),
    links: z
      .array(
        z
          .object({
            id: z.custom<WebChatLinkId>((value) => typeof value === 'string' && value.length > 0),
            name: z.string(),
            url: z.string(),
            enabled: z.boolean(),
          })
          .readonly(),
      )
      .readonly(),
  })
  .readonly()
  .superRefine((settings, context) => {
    for (const issue of validateWebChatSettings(settings))
      context.addIssue({
        code: 'custom',
        path: issue.path.replace(/^webChat\./u, '').split('.'),
        message: issue.message,
      });
  }) satisfies z.ZodType<WebChatSettings>;
export const budgetSettingsSchema = z.object({ hardStop: z.boolean() }).readonly() satisfies z.ZodType<BudgetSettings>;
export const pricingSettingsSchema = z
  .object({
    autoUpdate: z.boolean(),
    updateIntervalHours: z.number(),
    maxAutoChangePercent: z.number(),
    extractionModelKey: modelKeySchema,
  })
  .readonly() satisfies z.ZodType<PricingSettings>;
export const fxSettingsSchema = z
  .object({ autoUpdate: z.boolean(), manualUsdToVnd: z.number().nullable() })
  .readonly() satisfies z.ZodType<FxSettings>;
export const vscodeSettingsSchema = z
  .object({
    autoLaunch: z.boolean(),
    codeExecutable: z.string().nullable(),
    showDiffBeforeValidate: z.boolean(),
    revealChangedFiles: z.boolean(),
  })
  .readonly() satisfies z.ZodType<VSCodeSettings>;
export const pipelineSettingsSchema = z
  .object({
    roleAssignment: roleAssignmentSchema,
    validationCommands: z.array(commandSpecSchema).readonly(),
    maxFixAttempts: z.literal(1),
  })
  .readonly() satisfies z.ZodType<PipelineSettings>;
export const ragSettingsSchema = z
  .object({
    embedding: embeddingConfigSchema,
    chunking: chunkingConfigSchema,
    defaultTopK: z.number(),
    minScore: z.number(),
  })
  .readonly() satisfies z.ZodType<RagSettings>;
export const imageSettingsSchema = z
  .object({ enabled: z.boolean(), providerOrder: z.array(imageProviderIdSchema).readonly() })
  .readonly() satisfies z.ZodType<ImageSettings>;
export const uiSettingsSchema = z
  .object({ themeId: themeIdSchema, mode: z.enum(['system', 'light', 'dark']), locale: z.enum(['en', 'vi']) })
  .readonly() satisfies z.ZodType<UiSettings>;
export const appSettingsSchema = z
  .object({
    activeProjectId: projectIdSchema.nullable(),
    router: routerConfigSchema,
    budget: budgetSettingsSchema,
    pricing: pricingSettingsSchema,
    fx: fxSettingsSchema,
    vscode: vscodeSettingsSchema,
    pipeline: pipelineSettingsSchema,
    rag: ragSettingsSchema,
    image: imageSettingsSchema,
    ui: uiSettingsSchema,
    webChat: webChatSettingsSchema,
  })
  .readonly() satisfies z.ZodType<AppSettings>;
export const settingsPatchSchema = z
  .object({
    activeProjectId: projectIdSchema.nullable().exactOptional(),
    router: z
      .object({
        ladder: z.array(ladderEntrySchema).readonly().exactOptional(),
        autoFallback: z.boolean().exactOptional(),
        lockedModelKey: modelKeySchema.nullable().exactOptional(),
        circuitBreaker: circuitBreakerConfigSchema.exactOptional(),
        userDecisionTimeoutMs: z.number().exactOptional(),
      })
      .readonly()
      .exactOptional(),
    budget: z.object({ hardStop: z.boolean().exactOptional() }).readonly().exactOptional(),
    pricing: z
      .object({
        autoUpdate: z.boolean().exactOptional(),
        updateIntervalHours: z.number().exactOptional(),
        maxAutoChangePercent: z.number().exactOptional(),
        extractionModelKey: modelKeySchema.exactOptional(),
      })
      .readonly()
      .exactOptional(),
    fx: z
      .object({ autoUpdate: z.boolean().exactOptional(), manualUsdToVnd: z.number().nullable().exactOptional() })
      .readonly()
      .exactOptional(),
    vscode: z
      .object({
        autoLaunch: z.boolean().exactOptional(),
        codeExecutable: z.string().nullable().exactOptional(),
        showDiffBeforeValidate: z.boolean().exactOptional(),
        revealChangedFiles: z.boolean().exactOptional(),
      })
      .readonly()
      .exactOptional(),
    pipeline: z
      .object({
        roleAssignment: roleAssignmentSchema.exactOptional(),
        validationCommands: z.array(commandSpecSchema).readonly().exactOptional(),
        maxFixAttempts: z.literal(1).exactOptional(),
      })
      .readonly()
      .exactOptional(),
    rag: z
      .object({
        embedding: embeddingConfigSchema.exactOptional(),
        chunking: chunkingConfigSchema.exactOptional(),
        defaultTopK: z.number().exactOptional(),
        minScore: z.number().exactOptional(),
      })
      .readonly()
      .exactOptional(),
    image: z
      .object({
        enabled: z.boolean().exactOptional(),
        providerOrder: z.array(imageProviderIdSchema).readonly().exactOptional(),
      })
      .readonly()
      .exactOptional(),
    ui: z
      .object({
        themeId: themeIdSchema.exactOptional(),
        mode: z.enum(['system', 'light', 'dark']).exactOptional(),
        locale: z.enum(['en', 'vi']).exactOptional(),
      })
      .readonly()
      .exactOptional(),
    webChat: z
      .object({
        browser: webChatBrowserSchema.exactOptional(),
        customBrowserPath: z.string().nullable().exactOptional(),
        links: z
          .array(
            z
              .object({
                id: z.custom<WebChatLinkId>((value) => typeof value === 'string' && value.length > 0),
                name: z.string(),
                url: z.string(),
                enabled: z.boolean(),
              })
              .readonly(),
          )
          .readonly()
          .exactOptional(),
      })
      .readonly()
      .exactOptional(),
  })
  .readonly() satisfies z.ZodType<SettingsPatch>;
