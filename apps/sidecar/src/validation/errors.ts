import type { AppError, ErrorCode } from '@itstudio/schemas';
import { jsonObjectSchema, z } from './common.js';
export const errorCodeSchema = z.enum([
  'VALIDATION',
  'NOT_FOUND',
  'CONFLICT',
  'SECRET_MISSING',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_QUOTA_EXHAUSTED',
  'PROVIDER_AUTH',
  'PROVIDER_SERVER',
  'PROVIDER_TIMEOUT',
  'PROVIDER_BAD_REQUEST',
  'PROVIDER_CONTENT_FILTERED',
  'LADDER_EXHAUSTED',
  'FALLBACK_DECLINED',
  'BUDGET_HARD_STOP',
  'PATH_OUTSIDE_WORKSPACE',
  'PATCH_CONFLICT',
  'COMMAND_FAILED',
  'ROLLBACK_FAILED',
  'PIPELINE_REVIEW_REJECTED',
  'VSCODE_UNAVAILABLE',
  'CANCELLED',
  'INTERNAL',
]) satisfies z.ZodType<ErrorCode>;
export const appErrorSchema = z
  .object({
    code: errorCodeSchema,
    message: z.string(),
    remediation: z.array(z.string()).readonly().exactOptional(),
    retryable: z.boolean(),
    details: jsonObjectSchema.exactOptional(),
  })
  .readonly() satisfies z.ZodType<AppError>;
