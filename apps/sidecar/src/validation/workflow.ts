import {
  WorkflowModuleId,
  type ActivityEvent,
  type WorkflowGraph,
  type WorkflowModuleId as ModuleId,
} from '@itstudio/schemas';
import { z } from './common.js';
import {
  activityEventIdSchema,
  isoDateTimeSchema,
  llmRequestIdSchema,
  conversationIdSchema,
  pipelineRunIdSchema,
  ingestJobIdSchema,
  ledgerEntryIdSchema,
  transactionIdSchema,
  commandRunIdSchema,
} from './brand.js';
import { projectIdSchema } from './common.js';
import { moneyDisplaySchema } from './cost.js';

export const workflowModuleIdSchema = z.enum(Object.values(WorkflowModuleId) as [ModuleId, ...ModuleId[]]);
export const activityEventSchema = z
  .object({
    id: activityEventIdSchema,
    projectId: projectIdSchema.nullable(),
    moduleId: workflowModuleIdSchema,
    edgeId: z.string().exactOptional(),
    kind: z.enum(['started', 'progress', 'completed', 'failed', 'info']),
    summary: z.string().max(500),
    refs: z
      .object({
        requestId: llmRequestIdSchema.exactOptional(),
        conversationId: conversationIdSchema.exactOptional(),
        pipelineRunId: pipelineRunIdSchema.exactOptional(),
        ingestJobId: ingestJobIdSchema.exactOptional(),
        ledgerEntryId: ledgerEntryIdSchema.exactOptional(),
        transactionId: transactionIdSchema.exactOptional(),
        commandRunId: commandRunIdSchema.exactOptional(),
      })
      .readonly(),
    durationMs: z.number().nonnegative().exactOptional(),
    cost: moneyDisplaySchema.exactOptional(),
    ts: isoDateTimeSchema,
  })
  .readonly() satisfies z.ZodType<ActivityEvent>;

export const workflowGraphSchema = z
  .object({
    projectId: projectIdSchema.nullable(),
    nodes: z
      .array(
        z
          .object({
            id: workflowModuleIdSchema,
            lane: z.enum(['ui', 'engine', 'data', 'pipeline', 'storage']),
            labelKey: z.string(),
            status: z.enum(['idle', 'active', 'error', 'disabled']),
            inFlight: z.number().int().nonnegative(),
            calls24h: z.number().int().nonnegative(),
            errors24h: z.number().int().nonnegative(),
            cost24h: moneyDisplaySchema.exactOptional(),
          })
          .readonly(),
      )
      .readonly(),
    edges: z
      .array(
        z
          .object({
            id: z.string(),
            from: workflowModuleIdSchema,
            to: workflowModuleIdSchema,
            contract: z.string(),
            lastFlowAt: isoDateTimeSchema.exactOptional(),
          })
          .readonly(),
      )
      .readonly(),
    generatedAt: isoDateTimeSchema,
  })
  .readonly() satisfies z.ZodType<WorkflowGraph>;
