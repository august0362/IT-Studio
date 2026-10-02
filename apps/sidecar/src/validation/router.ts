import type {
  FallbackDecision,
  FallbackDecisionRequest,
  FailureKind,
  LlmRequest,
  LlmResponse,
  RouterAttempt,
  RouterConfig,
  RouterEvent,
  RouterState,
} from '@itstudio/schemas';
import { moneyDisplaySchema } from './cost.js';
import { modelKeySchema, z, isoDateTimeSchema, llmRequestIdSchema, projectIdSchema, microUsdSchema } from './common.js';
import { pipelineRunIdSchema } from './brand.js';
import { chatMessageSchema, toolDeclarationSchema } from './chat.js';
import { modelCapabilitySchema } from './models.js';
import { tokenUsageSchema } from './chat.js';
import { costPurposeSchema } from './cost.js';
export const failureKindSchema = z.enum([
  'rate_limited',
  'quota_exhausted',
  'server_error',
  'timeout',
  'auth',
  'bad_request',
  'content_filtered',
  'capability_mismatch',
  'circuit_open',
]) satisfies z.ZodType<FailureKind>;
export const routerStateSchema = z.enum([
  'idle',
  'budget_check',
  'dispatching',
  'streaming',
  'retry_wait',
  'falling_back',
  'awaiting_user',
  'succeeded',
  'failed',
  'cancelled',
]) satisfies z.ZodType<RouterState>;
export const routerAttemptSchema = z
  .object({
    modelKey: modelKeySchema,
    startedAt: isoDateTimeSchema,
    latencyMs: z.number(),
    outcome: z.enum(['success', 'failed', 'skipped']),
    failure: failureKindSchema.exactOptional(),
    httpStatus: z.number().exactOptional(),
    retryAfterMs: z.number().exactOptional(),
  })
  .readonly() satisfies z.ZodType<RouterAttempt>;
export const ladderEntrySchema = z
  .object({
    modelKey: modelKeySchema,
    priority: z.number().int(),
    enabled: z.boolean(),
    maxRetries: z.number().int(),
    timeoutMs: z.number().int(),
  })
  .readonly();
export const circuitBreakerConfigSchema = z
  .object({ failureThreshold: z.number().int(), cooldownMs: z.number().int() })
  .readonly();
export const routerConfigSchema = z
  .object({
    ladder: z.array(ladderEntrySchema).readonly(),
    autoFallback: z.boolean(),
    lockedModelKey: modelKeySchema.nullable(),
    circuitBreaker: circuitBreakerConfigSchema,
    userDecisionTimeoutMs: z.number().int(),
  })
  .readonly() satisfies z.ZodType<RouterConfig>;
export const routerEventSchema: z.ZodType<RouterEvent> = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('state'),
      requestId: llmRequestIdSchema,
      state: routerStateSchema,
      modelKey: modelKeySchema.exactOptional(),
    })
    .readonly(),
  z
    .object({ type: z.literal('attempt_failed'), requestId: llmRequestIdSchema, attempt: routerAttemptSchema })
    .readonly(),
  z
    .object({
      type: z.literal('fallback'),
      requestId: llmRequestIdSchema,
      from: modelKeySchema,
      to: modelKeySchema,
      reason: failureKindSchema,
    })
    .readonly(),
  z
    .object({ type: z.literal('circuit'), modelKey: modelKeySchema, status: z.enum(['open', 'half_open', 'closed']) })
    .readonly(),
]);
export const fallbackDecisionRequestSchema = z
  .object({
    requestId: llmRequestIdSchema,
    failedModel: modelKeySchema,
    reason: failureKindSchema,
    candidates: z
      .array(
        z
          .object({
            modelKey: modelKeySchema,
            estimatedCostMicroUsd: microUsdSchema,
            estimatedCost: moneyDisplaySchema.exactOptional(),
          })
          .readonly(),
      )
      .readonly(),
    expiresAt: isoDateTimeSchema,
  })
  .readonly() satisfies z.ZodType<FallbackDecisionRequest>;
export const fallbackDecisionSchema: z.ZodType<FallbackDecision> = z.discriminatedUnion('action', [
  z.object({ requestId: llmRequestIdSchema, action: z.literal('use_model'), modelKey: modelKeySchema }).readonly(),
  z.object({ requestId: llmRequestIdSchema, action: z.literal('retry_same') }).readonly(),
  z.object({ requestId: llmRequestIdSchema, action: z.literal('abort') }).readonly(),
]);
export const llmRequestSchema = z
  .object({
    id: llmRequestIdSchema,
    projectId: projectIdSchema,
    pipelineRunId: pipelineRunIdSchema.exactOptional(),
    purpose: costPurposeSchema,
    messages: z.array(chatMessageSchema).readonly(),
    systemPrompt: z.string().exactOptional(),
    tools: z.array(toolDeclarationSchema).readonly().exactOptional(),
    requiredCapabilities: z.array(modelCapabilitySchema).readonly(),
    maxOutputTokens: z.number().exactOptional(),
    temperature: z.number().exactOptional(),
    responseFormat: z.enum(['text', 'json']).exactOptional(),
    ladderOverride: z.array(modelKeySchema).readonly().exactOptional(),
    stream: z.boolean(),
  })
  .readonly() satisfies z.ZodType<LlmRequest>;
export const llmResponseSchema = z
  .object({
    requestId: llmRequestIdSchema,
    modelKey: modelKeySchema,
    message: chatMessageSchema,
    usage: tokenUsageSchema,
    costMicroUsd: microUsdSchema,
    finishReason: z.enum(['stop', 'length', 'tool_calls', 'content_filter']),
    attempts: z.array(routerAttemptSchema).readonly(),
    latencyMs: z.number(),
  })
  .readonly() satisfies z.ZodType<LlmResponse>;
