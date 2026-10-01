import type { ExtHello, ExtToSidecar, SidecarToExt, VSCodeStatus } from '@itstudio/schemas';
import { sha256Schema, transactionIdSchema, workspaceRelativePathSchema, z } from './common.js';
import { diagnosticSchema, transactionStatusSchema } from './worker.js';
export const vscodeStatusSchema = z
  .object({
    installed: z.boolean(),
    extensionInstalled: z.boolean(),
    connected: z.boolean(),
    workspaceRoot: z.string().exactOptional(),
    extensionVersion: z.string().exactOptional(),
  })
  .readonly() satisfies z.ZodType<VSCodeStatus>;
export const extHelloSchema = z
  .object({
    type: z.literal('hello'),
    protocolVersion: z.literal(1),
    token: z.string(),
    workspaceRoot: z.string(),
    extensionVersion: z.string(),
  })
  .readonly() satisfies z.ZodType<ExtHello>;
export const extToSidecarSchema: z.ZodType<ExtToSidecar> = z.discriminatedUnion('type', [
  extHelloSchema,
  z.object({ type: z.literal('diagnostics'), diagnostics: z.array(diagnosticSchema).readonly() }).readonly(),
  z.object({ type: z.literal('file_saved_by_user'), path: workspaceRelativePathSchema, hash: sha256Schema }).readonly(),
  z.object({ type: z.literal('ack'), ref: z.number() }).readonly(),
  z.object({ type: z.literal('pong') }).readonly(),
]);
export const sidecarToExtSchema: z.ZodType<SidecarToExt> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('welcome'), sessionId: z.string() }).readonly(),
  z
    .object({
      type: z.literal('reveal'),
      ref: z.number(),
      path: workspaceRelativePathSchema,
      line: z.number().exactOptional(),
    })
    .readonly(),
  z
    .object({
      type: z.literal('show_diff'),
      ref: z.number(),
      path: workspaceRelativePathSchema,
      before: z.string(),
      after: z.string(),
      title: z.string(),
    })
    .readonly(),
  z
    .object({
      type: z.literal('transaction'),
      ref: z.number(),
      transactionId: transactionIdSchema,
      status: transactionStatusSchema,
      paths: z.array(workspaceRelativePathSchema).readonly(),
    })
    .readonly(),
  z
    .object({
      type: z.literal('notify'),
      ref: z.number(),
      level: z.enum(['info', 'warning', 'error']),
      message: z.string(),
    })
    .readonly(),
  z.object({ type: z.literal('request_diagnostics'), ref: z.number() }).readonly(),
  z.object({ type: z.literal('ping') }).readonly(),
]);
