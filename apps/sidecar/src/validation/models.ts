import type { ModelCapability, ModelDescriptor, ModelKey, ProviderId, SecretStatus } from '@itstudio/schemas';
import { isoDateTimeSchema, modelKeySchema, providerIdSchema, z } from './common.js';
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
export const modelKeyContractSchema = modelKeySchema satisfies z.ZodType<ModelKey>;
export const providerIdContractSchema = providerIdSchema satisfies z.ZodType<ProviderId>;
