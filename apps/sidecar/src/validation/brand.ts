import { z } from 'zod';
import type { Brand, MicroUsd, PriceTableVersion, Sha256, Vnd, WorkspaceRelativePath } from '@itstudio/schemas';

const brandedUuid = <T extends string>() => z.uuid().transform((value) => value as Brand<string, T>);
export const projectIdSchema = brandedUuid<'ProjectId'>();
export const conversationIdSchema = brandedUuid<'ConversationId'>();
export const messageIdSchema = brandedUuid<'MessageId'>();
export const llmRequestIdSchema = brandedUuid<'LlmRequestId'>();
export const pipelineRunIdSchema = brandedUuid<'PipelineRunId'>();
export const ledgerEntryIdSchema = brandedUuid<'LedgerEntryId'>();
export const revenueEntryIdSchema = brandedUuid<'RevenueEntryId'>();
export const documentIdSchema = brandedUuid<'DocumentId'>();
export const chunkIdSchema = brandedUuid<'ChunkId'>();
export const ingestJobIdSchema = brandedUuid<'IngestJobId'>();
export const transactionIdSchema = brandedUuid<'TransactionId'>();
export const commandRunIdSchema = brandedUuid<'CommandRunId'>();
export const activityEventIdSchema = brandedUuid<'ActivityEventId'>();
/** Provider-issued opaque id (Anthropic toolu_…, OpenAI call_…, Gemini synthetic call_<n>) — not a UUID (CONVENTIONS §2.1). */
export const toolCallIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,128}$/)
  .transform((value) => value as Brand<string, 'ToolCallId'>);
export const imageAssetIdSchema = brandedUuid<'ImageAssetId'>();
export const priceTableVersionSchema = z
  .string()
  .min(1)
  .regex(/\S/)
  .transform((value) => value as PriceTableVersion);
export const isoDateTimeSchema = z.iso
  .datetime({ offset: false })
  .transform((value) => value as Brand<string, 'IsoDateTime'>);
export const microUsdSchema = z
  .number()
  .int()
  .nonnegative()
  .transform((value) => value as MicroUsd);
export const signedMicroUsdSchema = z
  .number()
  .int()
  .transform((value) => value as MicroUsd);
export const vndSchema = z
  .number()
  .int()
  .nonnegative()
  .transform((value) => value as Vnd);
export const signedVndSchema = z
  .number()
  .int()
  .transform((value) => value as Vnd);
export const workspaceRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.startsWith('\\') &&
      !/^[A-Za-z]:/.test(value) &&
      !value.includes('\0') &&
      !value.split(/[\\/]/).includes('..'),
    'Expected a workspace-relative path without traversal',
  )
  .transform((value) => value.replace(/\\/g, '/') as WorkspaceRelativePath);
export const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .transform((value) => value as Sha256);
export const themeIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .transform((value) => value as Brand<string, 'ThemeId'>);
export const hexColorSchema = z
  .string()
  .regex(/^#[a-f0-9]{6}$/)
  .transform((value) => value as Brand<string, 'HexColor'>);
