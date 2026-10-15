import type { ProcessOperation } from '../ports/process-tracker.js';
import { z, providerIdSchema, modelKeySchema } from './common.js';
import { projectIdSchema, conversationIdSchema } from './brand.js';
import { generateImageArgsSchema } from './chat.js';

export const processOperationSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('chat'),
      params: z
        .strictObject({
          conversationId: conversationIdSchema,
          text: z.string(),
          modelOverride: modelKeySchema.exactOptional(),
        })
        .readonly(),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('code_pipeline'),
      params: z.strictObject({ projectId: projectIdSchema, prompt: z.string() }).readonly(),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('knowledge_ingest'),
      params: z
        .strictObject({
          projectId: projectIdSchema,
          paths: z.array(z.string()).readonly(),
          tags: z.array(z.string()).readonly().exactOptional(),
        })
        .readonly(),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('image'),
      params: z.strictObject({ projectId: projectIdSchema, args: generateImageArgsSchema }).readonly(),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('price_update'),
      params: z.strictObject({ projectId: projectIdSchema, modelKey: modelKeySchema }).readonly(),
    })
    .readonly(),
  z
    .strictObject({ kind: z.literal('key_verify'), params: z.strictObject({ provider: providerIdSchema }).readonly() })
    .readonly(),
]) satisfies z.ZodType<ProcessOperation>;
