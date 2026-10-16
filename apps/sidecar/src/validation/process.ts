import {
  ProcessKind,
  ProcessStatus,
  ProcessModuleState,
  type ProcessRecord,
  type ProcessEvent,
} from '@itstudio/schemas';
import { z, jsonObjectSchema } from './common.js';
import { processIdSchema, projectIdSchema, isoDateTimeSchema } from './brand.js';

export const processKindSchema = z.enum(ProcessKind);
export const processStatusSchema = z.enum(ProcessStatus);
export const processModuleSchema = z
  .strictObject({
    id: z.string().min(1),
    label: z.string().min(1),
    state: z.enum(ProcessModuleState),
    startedAt: isoDateTimeSchema.exactOptional(),
    endedAt: isoDateTimeSchema.exactOptional(),
    input: z.string().max(500).exactOptional(),
    output: z.string().max(500).exactOptional(),
    detail: jsonObjectSchema.exactOptional(),
  })
  .readonly();
export const processRecordSchema = z
  .strictObject({
    id: processIdSchema,
    kind: processKindSchema,
    projectId: projectIdSchema.exactOptional(),
    title: z.string().max(120),
    status: processStatusSchema,
    statusReason: z.string().max(500).exactOptional(),
    modules: z.array(processModuleSchema).readonly(),
    edges: z
      .array(
        z.strictObject({ from: z.string(), to: z.string(), label: z.string().max(500).exactOptional() }).readonly(),
      )
      .readonly(),
    result: z.string().max(500).exactOptional(),
    costText: z.string().max(500).exactOptional(),
    ref: z
      .strictObject({
        type: z.enum([
          'conversation',
          'pipeline_run',
          'ingest_job',
          'image',
          'price_run',
          'webchat_link',
          'orchestration_run',
        ]),
        id: z.string(),
      })
      .readonly()
      .exactOptional(),
    retryable: z.boolean(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    endedAt: isoDateTimeSchema.exactOptional(),
  })
  .readonly() satisfies z.ZodType<ProcessRecord>;
export const processEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('upsert'), process: processRecordSchema }).readonly(),
  z.strictObject({ type: z.literal('removed'), id: processIdSchema }).readonly(),
]) satisfies z.ZodType<ProcessEvent>;

export const processListSchema = z
  .strictObject({
    projectId: projectIdSchema.exactOptional(),
    status: z.array(processStatusSchema).readonly().exactOptional(),
    kind: z.array(processKindSchema).readonly().exactOptional(),
    limit: z.number().int().min(1).max(1000),
  })
  .readonly();
export const processIdentitySchema = z.strictObject({ id: processIdSchema }).readonly();
export const processReportSchema = z
  .strictObject({
    kind: z.literal('web_chat'),
    linkId: z.string().min(1).max(200),
    event: z.enum(['opened', 'loaded', 'closed', 'failed']),
    projectId: projectIdSchema.exactOptional(),
  })
  .readonly();
