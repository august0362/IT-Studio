import type {
  CommandKind,
  CommandRun,
  CommandSpec,
  Diagnostic,
  FileOperation,
  TestSummary,
  TransactionStatus,
  WriteTransaction,
} from '@itstudio/schemas';
import {
  commandRunIdSchema,
  isoDateTimeSchema,
  pipelineRunIdSchema,
  projectIdSchema,
  sha256Schema,
  transactionIdSchema,
  workspaceRelativePathSchema,
  z,
} from './common.js';
export const commandKindSchema = z.enum([
  'install',
  'typecheck',
  'lint',
  'test',
  'build',
]) satisfies z.ZodType<CommandKind>;
export const fileOperationSchema: z.ZodType<FileOperation> = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('create'), path: workspaceRelativePathSchema, content: z.string().max(1024 * 1024) })
    .readonly(),
  z
    .object({
      kind: z.literal('replace'),
      path: workspaceRelativePathSchema,
      content: z.string().max(1024 * 1024),
      baseHash: sha256Schema,
    })
    .readonly(),
  z
    .object({
      kind: z.literal('patch'),
      path: workspaceRelativePathSchema,
      unifiedDiff: z.string(),
      baseHash: sha256Schema,
    })
    .readonly(),
  z.object({ kind: z.literal('delete'), path: workspaceRelativePathSchema, baseHash: sha256Schema }).readonly(),
  z
    .object({
      kind: z.literal('rename'),
      from: workspaceRelativePathSchema,
      to: workspaceRelativePathSchema,
      baseHash: sha256Schema,
    })
    .readonly(),
]);
export const transactionStatusSchema = z.enum([
  'prepared',
  'committed',
  'validated',
  'rolled_back',
  'rollback_failed',
]) satisfies z.ZodType<TransactionStatus>;
export const writeTransactionSchema = z
  .object({
    id: transactionIdSchema,
    projectId: projectIdSchema,
    runId: pipelineRunIdSchema.exactOptional(),
    operations: z.array(fileOperationSchema).max(200).readonly(),
    snapshotRef: z.string(),
    status: transactionStatusSchema,
    createdAt: isoDateTimeSchema,
  })
  .readonly() satisfies z.ZodType<WriteTransaction>;
export const commandSpecSchema = z
  .object({
    kind: commandKindSchema,
    executable: z.string(),
    args: z.array(z.string()).readonly(),
    timeoutMs: z.number(),
  })
  .readonly() satisfies z.ZodType<CommandSpec>;
export const diagnosticSchema = z
  .object({
    source: z.enum(['tsc', 'eslint', 'vitest', 'vscode']),
    severity: z.enum(['error', 'warning', 'info']),
    path: workspaceRelativePathSchema,
    line: z.number(),
    column: z.number(),
    message: z.string(),
    code: z.string().exactOptional(),
  })
  .readonly() satisfies z.ZodType<Diagnostic>;
export const testSummarySchema = z
  .object({
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
    failures: z
      .array(
        z
          .object({ name: z.string(), message: z.string(), path: workspaceRelativePathSchema.exactOptional() })
          .readonly(),
      )
      .readonly(),
  })
  .readonly() satisfies z.ZodType<TestSummary>;
export const commandRunSchema = z
  .object({
    id: commandRunIdSchema,
    spec: commandSpecSchema,
    exitCode: z.number().nullable(),
    timedOut: z.boolean(),
    durationMs: z.number(),
    stdoutTail: z.string(),
    stderrTail: z.string(),
    diagnostics: z.array(diagnosticSchema).readonly(),
    tests: testSummarySchema.exactOptional(),
  })
  .readonly() satisfies z.ZodType<CommandRun>;
