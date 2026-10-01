import type {
  CoderOutput,
  FailureReport,
  FindingCategory,
  FindingSeverity,
  PipelineEvent,
  PipelineRun,
  PipelineStage,
  ReviewFinding,
  ReviewVerdict,
  RoleAssignment,
  TaskSpec,
} from '@itstudio/schemas';
import { z } from 'zod';
import {
  isoDateTimeSchema,
  modelKeySchema,
  pipelineRunIdSchema,
  transactionIdSchema,
  workspaceRelativePathSchema,
  commandRunIdSchema,
  projectIdSchema,
} from './common.js';
import { appErrorSchema } from './errors.js';
import { moneyDisplaySchema } from './cost.js';
import { commandRunSchema, fileOperationSchema } from './worker.js';
export const agentRoleSchema = z.enum(['pm', 'coder', 'reviewer']);
export const roleAssignmentSchema = z
  .object({
    pm: z.array(modelKeySchema).readonly(),
    coder: z.array(modelKeySchema).readonly(),
    reviewer: z.array(modelKeySchema).readonly(),
  })
  .readonly() satisfies z.ZodType<RoleAssignment>;
export const pipelineStageSchema = z.enum([
  'specifying',
  'coding',
  'reviewing',
  'fixing',
  're_reviewing',
  'writing',
  'validating',
  'completed',
  'rolled_back',
  'failed',
  'cancelled',
]) satisfies z.ZodType<PipelineStage>;
export const taskSpecSchema = z
  .object({
    title: z.string(),
    userStory: z.string(),
    acceptanceCriteria: z.array(z.string()).readonly(),
    allowedPaths: z.array(workspaceRelativePathSchema).max(50).readonly(),
    contracts: z.string(),
    constraints: z.array(z.string()).readonly(),
    testPlan: z.array(z.string()).readonly(),
    outOfScope: z.array(z.string()).readonly(),
  })
  .readonly() satisfies z.ZodType<TaskSpec>;
export const coderOutputSchema = z
  .object({
    summary: z.string(),
    operations: z.array(fileOperationSchema).max(200).readonly(),
    assumptions: z.array(z.string()).readonly(),
  })
  .readonly() satisfies z.ZodType<CoderOutput>;
export const findingSeveritySchema = z.enum(['blocker', 'major', 'minor', 'nit']) satisfies z.ZodType<FindingSeverity>;
export const findingCategorySchema = z.enum([
  'security_xss',
  'security_injection',
  'security_secret',
  'security_path',
  'correctness',
  'edge_case',
  'contract_violation',
  'scope_violation',
  'style',
  'testing',
]) satisfies z.ZodType<FindingCategory>;
export const reviewFindingSchema = z
  .object({
    severity: findingSeveritySchema,
    category: findingCategorySchema,
    path: workspaceRelativePathSchema,
    line: z.number().exactOptional(),
    message: z.string().max(2000),
    suggestedFix: z.string(),
  })
  .readonly() satisfies z.ZodType<ReviewFinding>;
export const reviewVerdictSchema = z
  .object({ approved: z.boolean(), findings: z.array(reviewFindingSchema).readonly(), summary: z.string() })
  .readonly()
  .refine(
    (value) =>
      !value.findings.some((finding) => finding.severity === 'blocker' || finding.severity === 'major') ||
      !value.approved,
    'Verdict cannot approve blocker or major findings',
  ) satisfies z.ZodType<ReviewVerdict>;
export const pipelineEventSchema: z.ZodType<PipelineEvent> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stage'), runId: pipelineRunIdSchema, stage: pipelineStageSchema }).readonly(),
  z
    .object({
      type: z.literal('artifact'),
      runId: pipelineRunIdSchema,
      kind: z.enum(['spec', 'code', 'review']),
      index: z.number(),
    })
    .readonly(),
  z
    .object({
      type: z.literal('command_output'),
      runId: pipelineRunIdSchema,
      commandRunId: commandRunIdSchema,
      stream: z.enum(['stdout', 'stderr']),
      chunk: z.string(),
    })
    .readonly(),
  z
    .object({
      type: z.literal('finished'),
      runId: pipelineRunIdSchema,
      stage: z.enum(['completed', 'rolled_back', 'failed', 'cancelled']),
    })
    .readonly(),
]);
export const failureReportSchema = z
  .object({
    runId: pipelineRunIdSchema.exactOptional(),
    stage: pipelineStageSchema,
    error: appErrorSchema,
    rolledBack: z.boolean(),
    restoredSnapshot: z.string().exactOptional(),
    nextSteps: z.array(z.string()).readonly(),
    logExcerpt: z.string(),
  })
  .readonly() satisfies z.ZodType<FailureReport>;
export const pipelineRunSchema = z
  .object({
    id: pipelineRunIdSchema,
    projectId: projectIdSchema,
    prompt: z.string(),
    stage: pipelineStageSchema,
    roleAssignment: roleAssignmentSchema,
    spec: taskSpecSchema.exactOptional(),
    coderOutputs: z.array(coderOutputSchema).readonly(),
    verdicts: z.array(reviewVerdictSchema).readonly(),
    fixAttempts: z.union([z.literal(0), z.literal(1)]),
    transactionId: transactionIdSchema.exactOptional(),
    validation: z.array(commandRunSchema).readonly().exactOptional(),
    failureReport: failureReportSchema.exactOptional(),
    cost: moneyDisplaySchema,
    startedAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema.exactOptional(),
  })
  .readonly() satisfies z.ZodType<PipelineRun>;
export const toJsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { unrepresentable: 'any' });
