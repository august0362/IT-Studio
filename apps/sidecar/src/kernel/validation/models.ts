import type {
  ModelCapability,
  ModelDescriptor,
  ModelKey,
  ProviderId,
  SecretHistoryEntry,
  SecretStatus,
} from '@itstudio/schemas';
import { isoDateTimeSchema, modelKeySchema, providerIdSchema, secretHistoryIdSchema, z } from './common.js';
import { errorCodeSchema } from './errors.js';
export const modelCapabilitySchema = z.enum([
  'chat',
  'tool_calling',
  'vision',
  'code',
  'embedding',
  'image_generation',
  'json_mode',
]) satisfies z.ZodType<ModelCapability>;
export const modelDescriptorSchema = z
  .object({
    key: modelKeySchema,
    provider: providerIdSchema,
    providerModelId: z.string(),
    displayName: z.string(),
    capabilities: z.array(modelCapabilitySchema).readonly(),
    contextWindowTokens: z.number().int().nonnegative(),
    maxOutputTokens: z.number().int().nonnegative(),
    enabled: z.boolean(),
  })
  .readonly() satisfies z.ZodType<ModelDescriptor>;
export const secretStatusSchema = z
  .object({
    provider: providerIdSchema,
    configured: z.boolean(),
    hint: z.string().exactOptional(),
    lastVerifiedAt: isoDateTimeSchema.exactOptional(),
  })
  .readonly() satisfies z.ZodType<SecretStatus>;
export const secretHistoryEntrySchema = z
  .object({
    id: secretHistoryIdSchema,
    provider: providerIdSchema,
    hint: z.string().max(4),
    action: z.enum(['saved', 'deleted', 'verify_failed']),
    resultCode: errorCodeSchema.nullable(),
    at: isoDateTimeSchema,
  })
  .readonly() satisfies z.ZodType<SecretHistoryEntry>;
export const modelKeyContractSchema = modelKeySchema satisfies z.ZodType<ModelKey>;
export const providerIdContractSchema = providerIdSchema satisfies z.ZodType<ProviderId>;
