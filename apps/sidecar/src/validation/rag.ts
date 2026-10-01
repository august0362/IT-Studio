import type {
  Chunk,
  ChunkingConfig,
  DocumentFormat,
  EmbeddingConfig,
  IngestJob,
  IngestStatus,
  RetrievalHit,
  RetrievalQuery,
  SourceDocument,
} from '@itstudio/schemas';
import {
  chunkIdSchema,
  documentIdSchema,
  ingestJobIdSchema,
  isoDateTimeSchema,
  microUsdSchema,
  modelKeySchema,
  projectIdSchema,
  sha256Schema,
  z,
} from './common.js';
import { appErrorSchema } from './errors.js';
export const documentFormatSchema = z.enum([
  'markdown',
  'text',
  'pdf',
  'docx',
  'code',
  'html',
]) satisfies z.ZodType<DocumentFormat>;
export const sourceDocumentSchema = z
  .object({
    id: documentIdSchema,
    projectId: projectIdSchema,
    title: z.string(),
    sourcePath: z.string(),
    format: documentFormatSchema,
    contentHash: sha256Schema,
    chunkCount: z.number(),
    embeddingModel: modelKeySchema,
    ingestedAt: isoDateTimeSchema,
    tags: z.array(z.string()).readonly(),
  })
  .readonly() satisfies z.ZodType<SourceDocument>;
export const chunkSchema = z
  .object({
    id: chunkIdSchema,
    documentId: documentIdSchema,
    projectId: projectIdSchema,
    ordinal: z.number(),
    text: z.string(),
    tokenCount: z.number(),
    sectionPath: z.array(z.string()).readonly(),
    embeddingDim: z.number(),
  })
  .readonly() satisfies z.ZodType<Chunk>;
export const chunkingConfigSchema = z
  .object({ targetTokens: z.number(), overlapTokens: z.number(), respectHeadings: z.boolean() })
  .readonly() satisfies z.ZodType<ChunkingConfig>;
export const embeddingConfigSchema = z
  .object({
    modelKey: modelKeySchema,
    dimensions: z.number(),
    batchSize: z.number(),
    fallbackModelKeys: z.array(modelKeySchema).readonly(),
  })
  .readonly() satisfies z.ZodType<EmbeddingConfig>;
export const ingestStatusSchema = z.enum([
  'queued',
  'parsing',
  'chunking',
  'embedding',
  'indexed',
  'failed',
  'skipped_unchanged',
]) satisfies z.ZodType<IngestStatus>;
export const ingestJobSchema = z
  .object({
    id: ingestJobIdSchema,
    projectId: projectIdSchema,
    paths: z.array(z.string()).readonly(),
    status: ingestStatusSchema,
    processedFiles: z.number(),
    totalFiles: z.number(),
    cost: microUsdSchema,
    error: appErrorSchema.exactOptional(),
  })
  .readonly() satisfies z.ZodType<IngestJob>;
export const retrievalQuerySchema = z
  .object({
    projectId: projectIdSchema,
    query: z.string(),
    topK: z.number(),
    minScore: z.number().min(0).max(1),
    tagFilter: z.array(z.string()).readonly().exactOptional(),
  })
  .readonly() satisfies z.ZodType<RetrievalQuery>;
export const retrievalHitSchema = z
  .object({
    chunkId: chunkIdSchema,
    documentId: documentIdSchema,
    documentTitle: z.string(),
    sectionPath: z.array(z.string()).readonly(),
    text: z.string(),
    score: z.number(),
  })
  .readonly() satisfies z.ZodType<RetrievalHit>;
