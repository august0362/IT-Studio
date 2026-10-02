import type {
  Budget,
  BudgetPeriod,
  BudgetStatus,
  CostBreakdownRow,
  CostPurpose,
  FxRate,
  LedgerEntry,
  LedgerQuery,
  MoneyDisplay,
  Page,
  PriceEntry,
  PriceTable,
  PriceUpdateRun,
  PortfolioPnL,
  ProjectPnL,
  RevenueEntry,
} from '@itstudio/schemas';
import {
  conversationIdSchema,
  isoDateTimeSchema,
  ledgerEntryIdSchema,
  llmRequestIdSchema,
  microUsdSchema,
  signedMicroUsdSchema,
  signedVndSchema,
  modelKeySchema,
  pipelineRunIdSchema,
  priceTableVersionSchema,
  projectIdSchema,
  revenueEntryIdSchema,
  vndSchema,
  z,
} from './common.js';
import { appErrorSchema } from './errors.js';
import { tokenUsageSchema } from './chat.js';
export const costPurposeSchema = z.enum([
  'chat',
  'pipeline_pm',
  'pipeline_coder',
  'pipeline_reviewer',
  'embedding',
  'image',
  'pricing_extraction',
]) satisfies z.ZodType<CostPurpose>;
export const priceEntrySchema = z
  .object({
    modelKey: modelKeySchema,
    inputPerMTokMicroUsd: microUsdSchema,
    outputPerMTokMicroUsd: microUsdSchema,
    cachedInputPerMTokMicroUsd: microUsdSchema,
    perImageMicroUsd: microUsdSchema.exactOptional(),
    freeTier: z.boolean(),
    sourceUrl: z.string(),
  })
  .readonly() satisfies z.ZodType<PriceEntry>;
export const priceTableSchema = z
  .object({
    version: priceTableVersionSchema,
    effectiveFrom: isoDateTimeSchema,
    entries: z.array(priceEntrySchema).readonly(),
    origin: z.enum(['seed', 'auto_extracted', 'manual_override']),
  })
  .readonly() satisfies z.ZodType<PriceTable>;
export const priceUpdateRunSchema = z
  .object({
    startedAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema,
    status: z.enum(['applied', 'rejected_validation', 'no_change', 'fetch_failed']),
    deltas: z
      .array(
        z
          .object({
            modelKey: modelKeySchema,
            field: z.enum([
              'modelKey',
              'inputPerMTokMicroUsd',
              'outputPerMTokMicroUsd',
              'cachedInputPerMTokMicroUsd',
              'perImageMicroUsd',
              'freeTier',
              'sourceUrl',
            ]),
            percent: z.number(),
          })
          .readonly(),
      )
      .readonly(),
    newVersion: priceTableVersionSchema.exactOptional(),
    error: appErrorSchema.exactOptional(),
  })
  .readonly() satisfies z.ZodType<PriceUpdateRun>;
export const fxRateSchema = z
  .object({ usdToVnd: z.number(), asOf: isoDateTimeSchema, source: z.enum(['auto', 'manual_override']) })
  .readonly() satisfies z.ZodType<FxRate>;
export const moneyDisplaySchema = z
  .object({
    microUsd: microUsdSchema,
    vnd: vndSchema,
    usdText: z.string(),
    vndText: z.string(),
    fxAsOf: isoDateTimeSchema,
  })
  .readonly() satisfies z.ZodType<MoneyDisplay>;
export const pnlMarginDisplaySchema = z
  .object({
    microUsd: signedMicroUsdSchema,
    vnd: signedVndSchema,
    usdText: z.string(),
    vndText: z.string(),
    fxAsOf: isoDateTimeSchema,
  })
  .readonly() satisfies z.ZodType<MoneyDisplay>;
export const ledgerEntrySchema = z
  .object({
    id: ledgerEntryIdSchema,
    projectId: projectIdSchema,
    occurredAt: isoDateTimeSchema,
    purpose: costPurposeSchema,
    modelKey: modelKeySchema,
    llmRequestId: llmRequestIdSchema.exactOptional(),
    pipelineRunId: pipelineRunIdSchema.exactOptional(),
    conversationId: conversationIdSchema.exactOptional(),
    usage: tokenUsageSchema,
    imageCount: z.number().exactOptional(),
    costMicroUsd: microUsdSchema,
    priceTableVersion: priceTableVersionSchema,
    billedFailure: z.boolean(),
  })
  .readonly() satisfies z.ZodType<LedgerEntry>;
export const revenueEntrySchema = z
  .object({
    id: revenueEntryIdSchema,
    projectId: projectIdSchema,
    occurredAt: isoDateTimeSchema,
    amountMicroUsd: microUsdSchema,
    enteredCurrency: z.enum(['USD', 'VND']),
    description: z.string(),
  })
  .readonly() satisfies z.ZodType<RevenueEntry>;
export const budgetPeriodSchema = z.enum(['daily', 'monthly', 'project_lifetime']) satisfies z.ZodType<BudgetPeriod>;
export const budgetSchema = z
  .object({
    projectId: projectIdSchema,
    period: budgetPeriodSchema,
    limitMicroUsd: microUsdSchema,
    warnAt: z.array(z.number()).readonly(),
  })
  .readonly() satisfies z.ZodType<Budget>;
export const budgetStatusSchema = z
  .object({
    budget: budgetSchema,
    spent: moneyDisplaySchema,
    remaining: moneyDisplaySchema,
    fractionUsed: z.number(),
    level: z.enum(['ok', 'warning', 'exceeded']),
    blocking: z.boolean(),
  })
  .readonly() satisfies z.ZodType<BudgetStatus>;
export const costBreakdownRowSchema = z
  .object({
    key: z.string(),
    cost: moneyDisplaySchema,
    inputTokens: z.number(),
    outputTokens: z.number(),
    requestCount: z.number(),
  })
  .readonly() satisfies z.ZodType<CostBreakdownRow>;
export const projectPnLSchema = z
  .object({
    projectId: projectIdSchema,
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
    revenue: moneyDisplaySchema,
    cost: moneyDisplaySchema,
    margin: pnlMarginDisplaySchema,
    marginPercent: z.number().nullable(),
    byModel: z.array(costBreakdownRowSchema).readonly(),
    byPurpose: z.array(costBreakdownRowSchema).readonly(),
    byDay: z.array(costBreakdownRowSchema).readonly(),
  })
  .readonly() satisfies z.ZodType<ProjectPnL>;
export const portfolioPnLSchema = z
  .object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
    projects: z.array(projectPnLSchema).readonly(),
    revenue: moneyDisplaySchema,
    cost: moneyDisplaySchema,
    margin: pnlMarginDisplaySchema,
    marginPercent: z.number().nullable(),
    byProject: z.array(costBreakdownRowSchema).readonly(),
    byModel: z.array(costBreakdownRowSchema).readonly(),
  })
  .readonly() satisfies z.ZodType<PortfolioPnL>;
export const ledgerQuerySchema = z
  .object({
    projectId: projectIdSchema,
    from: isoDateTimeSchema.exactOptional(),
    to: isoDateTimeSchema.exactOptional(),
    purposes: z.array(costPurposeSchema).readonly().exactOptional(),
    modelKeys: z.array(modelKeySchema).readonly().exactOptional(),
    limit: z.number(),
    cursor: z.string().exactOptional(),
  })
  .readonly() satisfies z.ZodType<LedgerQuery>;
export const pageSchema = <T>(item: z.ZodType<T>) =>
  z.object({ items: z.array(item).readonly(), nextCursor: z.string().nullable() }).readonly() satisfies z.ZodType<
    Page<T>
  >;
