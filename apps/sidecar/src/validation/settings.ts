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
  WebChatLayout,
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
export const webChatLayoutSchema = z
  .strictObject({
    panes: z
      .array(z.custom<WebChatLinkId>((value) => typeof value === 'string' && value.length > 0))
      .min(1)
      .max(4)
      .readonly(),
    sizes: z.array(z.number().min(0.1).max(1)).min(1).max(4).readonly(),
  })
  .readonly()
  .superRefine((layout, context) => {
    if (layout.panes.length !== layout.sizes.length)
      context.addIssue({ code: 'custom', path: ['sizes'], message: 'Provide one size for each pane.' });
    if (Math.abs(layout.sizes.reduce((total, size) => total + size, 0) - 1) > 0.000001)
      context.addIssue({ code: 'custom', path: ['sizes'], message: 'Pane sizes must total 1.' });
  }) satisfies z.ZodType<WebChatLayout>;
export const webChatSettingsSchema = z
  .strictObject({
    // Internal saved-settings metadata; callers cannot set it through SettingsPatch.
    presetsVersion: z.literal(1).exactOptional(),
    browser: webChatBrowserSchema,
    customBrowserPath: z.string().nullable(),
    layout: webChatLayoutSchema.exactOptional(),
    links: z
      .array(
        z
          .strictObject({
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
export const budgetSettingsSchema = z
  .strictObject({ hardStop: z.boolean() })
  .readonly() satisfies z.ZodType<BudgetSettings>;
export const pricingSettingsSchema = z
  .strictObject({
    autoUpdate: z.boolean(),
    updateIntervalHours: z.number(),
    maxAutoChangePercent: z.number(),
    extractionModelKey: modelKeySchema,
  })
  .readonly() satisfies z.ZodType<PricingSettings>;
export const fxSettingsSchema = z
  .strictObject({ autoUpdate: z.boolean(), manualUsdToVnd: z.number().min(10_000).max(100_000).nullable() })
  .readonly() satisfies z.ZodType<FxSettings>;
export const vscodeSettingsSchema = z
  .strictObject({
    closeWithStudio: z.boolean(),
    closeWithProject: z.boolean(),
    closeManuallyOpened: z.boolean(),
    autoLaunch: z.boolean(),
    codeExecutable: z.string().nullable(),
    showDiffBeforeValidate: z.boolean(),
    revealChangedFiles: z.boolean(),
  })
  .readonly() satisfies z.ZodType<VSCodeSettings>;
export const pipelineSettingsSchema = z
  .strictObject({
    roleAssignment: roleAssignmentSchema,
    validationCommands: z.array(commandSpecSchema).readonly(),
    maxFixAttempts: z.literal(1),
    autoClarify: z.boolean(),
  })
  .readonly() satisfies z.ZodType<PipelineSettings>;
export const ragSettingsSchema = z
  .strictObject({
    embedding: embeddingConfigSchema,
    chunking: chunkingConfigSchema,
    defaultTopK: z.number(),
    minScore: z.number(),
  })
  .readonly() satisfies z.ZodType<RagSettings>;
export const imageSettingsSchema = z
  .strictObject({ enabled: z.boolean(), providerOrder: z.array(imageProviderIdSchema).readonly() })
  .readonly() satisfies z.ZodType<ImageSettings>;
export const uiSettingsSchema = z
  .strictObject({ themeId: themeIdSchema, mode: z.enum(['system', 'light', 'dark']), locale: z.enum(['en', 'vi']) })
  .readonly() satisfies z.ZodType<UiSettings>;
const providersSettingsSchema = z
  .strictObject({
    qwen: z
      .strictObject({
        baseUrl: z
          .url({ protocol: /^https$/ })
          .max(300)
          .exactOptional(),
      })
      .readonly()
      .exactOptional(),
  })
  .readonly();

export const appSettingsSchema = z
  .strictObject({
    providers: providersSettingsSchema.exactOptional(),
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
  .strictObject({
    providers: providersSettingsSchema.exactOptional(),
    activeProjectId: projectIdSchema.nullable().exactOptional(),
    router: z
      .strictObject({
        ladder: z.array(ladderEntrySchema).readonly().exactOptional(),
        autoFallback: z.boolean().exactOptional(),
        lockedModelKey: modelKeySchema.nullable().exactOptional(),
        circuitBreaker: circuitBreakerConfigSchema.exactOptional(),
        userDecisionTimeoutMs: z.number().exactOptional(),
      })
      .readonly()
      .exactOptional(),
    budget: z.strictObject({ hardStop: z.boolean().exactOptional() }).readonly().exactOptional(),
    pricing: z
      .strictObject({
        autoUpdate: z.boolean().exactOptional(),
        updateIntervalHours: z.number().exactOptional(),
        maxAutoChangePercent: z.number().exactOptional(),
        extractionModelKey: modelKeySchema.exactOptional(),
      })
      .readonly()
      .exactOptional(),
    fx: z
      .strictObject({
        autoUpdate: z.boolean().exactOptional(),
        manualUsdToVnd: z.number().min(10_000).max(100_000).nullable().exactOptional(),
      })
      .readonly()
      .exactOptional(),
    vscode: z
      .strictObject({
        closeWithStudio: z.boolean().exactOptional(),
        closeWithProject: z.boolean().exactOptional(),
        closeManuallyOpened: z.boolean().exactOptional(),
        autoLaunch: z.boolean().exactOptional(),
        codeExecutable: z.string().nullable().exactOptional(),
        showDiffBeforeValidate: z.boolean().exactOptional(),
        revealChangedFiles: z.boolean().exactOptional(),
      })
      .readonly()
      .exactOptional(),
    pipeline: z
      .strictObject({
        roleAssignment: roleAssignmentSchema.exactOptional(),
        validationCommands: z.array(commandSpecSchema).readonly().exactOptional(),
        maxFixAttempts: z.literal(1).exactOptional(),
        autoClarify: z.boolean().exactOptional(),
      })
      .readonly()
      .exactOptional(),
    rag: z
      .strictObject({
        embedding: embeddingConfigSchema.exactOptional(),
        chunking: chunkingConfigSchema.exactOptional(),
        defaultTopK: z.number().exactOptional(),
        minScore: z.number().exactOptional(),
      })
      .readonly()
      .exactOptional(),
    image: z
      .strictObject({
        enabled: z.boolean().exactOptional(),
        providerOrder: z.array(imageProviderIdSchema).readonly().exactOptional(),
      })
      .readonly()
      .exactOptional(),
    ui: z
      .strictObject({
        themeId: themeIdSchema.exactOptional(),
        mode: z.enum(['system', 'light', 'dark']).exactOptional(),
        locale: z.enum(['en', 'vi']).exactOptional(),
      })
      .readonly()
      .exactOptional(),
    webChat: z
      .strictObject({
        browser: webChatBrowserSchema.exactOptional(),
        customBrowserPath: z.string().nullable().exactOptional(),
        layout: webChatLayoutSchema.exactOptional(),
        links: z
          .array(
            z
              .strictObject({
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
