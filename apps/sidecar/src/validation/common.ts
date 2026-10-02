import { z } from 'zod';
import { ErrorCode, type AppError, type JsonValue, type Result } from '@itstudio/schemas';
import {
  isoDateTimeSchema,
  microUsdSchema,
  signedMicroUsdSchema,
  signedVndSchema,
  vndSchema,
  workspaceRelativePathSchema,
  sha256Schema,
  themeIdSchema,
  hexColorSchema,
  projectIdSchema,
  conversationIdSchema,
  messageIdSchema,
  llmRequestIdSchema,
  pipelineRunIdSchema,
  ledgerEntryIdSchema,
  revenueEntryIdSchema,
  documentIdSchema,
  chunkIdSchema,
  ingestJobIdSchema,
  transactionIdSchema,
  commandRunIdSchema,
  toolCallIdSchema,
  imageAssetIdSchema,
  priceTableVersionSchema,
} from './brand.js';

export {
  z,
  isoDateTimeSchema,
  microUsdSchema,
  signedMicroUsdSchema,
  signedVndSchema,
  vndSchema,
  workspaceRelativePathSchema,
  sha256Schema,
  themeIdSchema,
  hexColorSchema,
  projectIdSchema,
  conversationIdSchema,
  messageIdSchema,
  llmRequestIdSchema,
  pipelineRunIdSchema,
  ledgerEntryIdSchema,
  revenueEntryIdSchema,
  documentIdSchema,
  chunkIdSchema,
  ingestJobIdSchema,
  transactionIdSchema,
  commandRunIdSchema,
  toolCallIdSchema,
  imageAssetIdSchema,
  priceTableVersionSchema,
};
export const providerIdSchema = z.enum(['anthropic', 'openai', 'google', 'xai', 'groq', 'together', 'replicate']);
export const modelKeySchema = z.templateLiteral([providerIdSchema, '/', z.string().regex(/^[A-Za-z0-9._:-]+$/)]);
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

export function parse<T>(schema: z.ZodType<T>, input: unknown): Result<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  const error: AppError = {
    code: ErrorCode.VALIDATION,
    message: 'Input failed validation',
    retryable: false,
    details: {
      issues: result.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })),
    },
  };
  return { ok: false, error };
}
