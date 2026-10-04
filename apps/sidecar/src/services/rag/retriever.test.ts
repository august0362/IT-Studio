import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppSettings, DocumentId, SourceDocument } from '@itstudio/schemas';
import { ErrorCode } from '@itstudio/schemas';
import { loadSeeds } from '../../config/load-seeds.js';
import { buildDefaultSettings } from '../../domain/default-settings.js';
import { MemoryVectorStore } from '../../infra/memory-vector-store.js';
import type { IDocumentRepository } from '../../ports/document-repository.js';
import {
  projectIdSchema,
  documentIdSchema,
  chunkIdSchema,
  sha256Schema,
  isoDateTimeSchema,
} from '../../validation/brand.js';
import { modelKeySchema } from '../../validation/common.js';
import { Retriever } from './retriever.js';
import type { WorkflowInternalEvent } from '../workflow-internal-events.js';

const projectId = projectIdSchema.parse('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const modelKey = modelKeySchema.parse('openai/text-embedding-3-small');
const firstDocId = documentIdSchema.parse('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const secondDocId = documentIdSchema.parse('cccccccc-cccc-4ccc-8ccc-cccccccccccc');

function baseSettings(): AppSettings {
  const seeds = loadSeeds(resolve(process.cwd(), 'config'));
  if (!seeds.ok) throw new Error(seeds.error.message);
  const defaults = buildDefaultSettings(seeds.value);
  return { ...defaults, rag: { ...defaults.rag, embedding: { ...defaults.rag.embedding, modelKey, dimensions: 2 } } };
}

function source(id: DocumentId, title: string, tags: readonly string[]): SourceDocument {
  return {
    id,
    projectId,
    title,
    sourcePath: `${title}.md`,
    format: 'markdown',
    contentHash: sha256Schema.parse('0'.repeat(64)),
    chunkCount: 1,
    embeddingModel: modelKey,
    ingestedAt: isoDateTimeSchema.parse('2026-10-02T00:00:00.000Z'),
    tags,
  };
}

describe('Retriever', () => {
  it('keeps the minScore boundary, applies all-of tags, and returns document metadata', async () => {
    const documents = [source(firstDocId, 'Guide', ['manual', 'public']), source(secondDocId, 'Private', ['manual'])];
    const repository: IDocumentRepository = {
      list: () => Promise.resolve(documents),
      getByPath: () => Promise.resolve(null),
      get: () => Promise.resolve(null),
      getEmbeddingDimensions: () =>
        Promise.resolve(
          new Map([
            [firstDocId, 2],
            [secondDocId, 2],
          ]),
        ),
      upsert: () => Promise.resolve(),
      delete: () => Promise.resolve(false),
    };
    const vectors = new MemoryVectorStore();
    const rows = await vectors.upsertChunks(projectId, [
      {
        chunkId: chunkIdSchema.parse('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
        documentId: firstDocId,
        projectId,
        ordinal: 0,
        text: 'equal score',
        sectionPath: ['Basics'],
        vector: [1, 0],
        tags: ['manual'],
      },
      {
        chunkId: chunkIdSchema.parse('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
        documentId: secondDocId,
        projectId,
        ordinal: 0,
        text: 'also equal',
        sectionPath: [],
        vector: [1, 0],
        tags: ['manual'],
      },
    ]);
    expect(rows.ok).toBe(true);
    const settings = baseSettings();
    let embeddingCalls = 0;
    const activity: WorkflowInternalEvent[] = [];
    const retriever = new Retriever({
      documents: repository,
      vectors,
      settings: { get: () => Promise.resolve({ ok: true, value: settings }) },
      embeddings: {
        embed: (texts) => {
          embeddingCalls += 1;
          return Promise.resolve({ ok: true, value: texts.map(() => [1, 0]) });
        },
      },
      internalEvents: {
        publish: (event) => activity.push(event),
        subscribe: () => () => undefined,
      },
    });
    const result = await retriever.query({
      projectId,
      query: 'where?',
      topK: 2,
      minScore: 1,
      tagFilter: ['manual', 'public'],
    });
    expect(result).toMatchObject({ ok: true, value: [{ documentTitle: 'Guide', sectionPath: ['Basics'], score: 1 }] });
    expect(embeddingCalls).toBe(1);
    expect(activity).toMatchObject([
      { type: 'retriever', phase: 'started', projectId },
      { type: 'retriever', phase: 'completed', projectId, hitCount: 1, topScore: 1 },
    ]);
    expect(JSON.stringify(activity)).not.toContain('where?');
  });

  it('rejects a mismatched index model and returns an empty index without embedding', async () => {
    const settings = baseSettings();
    const repository: IDocumentRepository = {
      list: () => Promise.resolve([source(firstDocId, 'Guide', [])]),
      getByPath: () => Promise.resolve(null),
      get: () => Promise.resolve(null),
      getEmbeddingDimensions: () => Promise.resolve(new Map([[firstDocId, 2]])),
      upsert: () => Promise.resolve(),
      delete: () => Promise.resolve(false),
    };
    const vectors = new MemoryVectorStore();
    let embedded = 0;
    const deps = {
      documents: repository,
      vectors,
      settings: { get: () => Promise.resolve({ ok: true as const, value: settings }) },
      embeddings: {
        embed: (texts: readonly string[]) => {
          embedded += texts.length;
          return Promise.resolve({ ok: true as const, value: texts.map(() => [1, 0]) });
        },
      },
    };
    const emptyRetriever = new Retriever({ ...deps, documents: { ...repository, list: () => Promise.resolve([]) } });
    expect(await emptyRetriever.query({ projectId, query: 'valid', topK: 1, minScore: 0 })).toEqual({
      ok: true,
      value: [],
    });
    expect(embedded).toBe(0);
    const mismatched = new Retriever({
      ...deps,
      documents: {
        ...repository,
        list: () =>
          Promise.resolve([
            { ...source(firstDocId, 'Guide', []), embeddingModel: modelKeySchema.parse('google/embedding-001') },
          ]),
      },
    });
    expect(await mismatched.query({ projectId, query: 'valid', topK: 1, minScore: 0 })).toMatchObject({
      ok: false,
      error: {
        code: ErrorCode.VALIDATION,
        message: 'Knowledge index uses another embedding model — re-index required',
      },
    });
    expect(embedded).toBe(0);
  });

  it('validates query boundaries and exposes search_knowledge with configured defaults and caps', async () => {
    const settings = baseSettings();
    const repository: IDocumentRepository = {
      list: () => Promise.resolve([]),
      getByPath: () => Promise.resolve(null),
      get: () => Promise.resolve(null),
      getEmbeddingDimensions: () => Promise.resolve(new Map()),
      upsert: () => Promise.resolve(),
      delete: () => Promise.resolve(false),
    };
    const vectors = new MemoryVectorStore();
    const retriever = new Retriever({
      documents: repository,
      vectors,
      settings: { get: () => Promise.resolve({ ok: true, value: settings }) },
      embeddings: { embed: (texts) => Promise.resolve({ ok: true, value: texts.map(() => [1, 0]) }) },
    });
    expect(await retriever.query({ projectId, query: ' ', topK: 1, minScore: 0 })).toMatchObject({
      ok: false,
      error: { code: ErrorCode.VALIDATION },
    });
    expect(await retriever.searchKnowledge(projectId, { query: 'knowledge' })).toEqual({ ok: true, value: [] });
    expect(await retriever.searchKnowledge(projectId, { query: 'knowledge', topK: 25 })).toEqual({
      ok: true,
      value: [],
    });
  });

  it('propagates retrieval dependency failures and handles empty matches and candidates', async () => {
    const settings = baseSettings();
    const repository: IDocumentRepository = {
      list: () => Promise.resolve([source(firstDocId, 'Guide', ['public'])]),
      getByPath: () => Promise.resolve(null),
      get: () => Promise.resolve(null),
      getEmbeddingDimensions: () => Promise.resolve(new Map([[firstDocId, 2]])),
      upsert: () => Promise.resolve(),
      delete: () => Promise.resolve(false),
    };
    const settingsFailure = {
      ok: false as const,
      error: { code: ErrorCode.INTERNAL, message: 'settings failed', retryable: false, remediation: ['Retry.'] },
    };
    const settingsFailureRetriever = new Retriever({
      documents: repository,
      vectors: new MemoryVectorStore(),
      settings: { get: () => Promise.resolve(settingsFailure) },
      embeddings: { embed: () => Promise.resolve({ ok: true, value: [[1, 0]] }) },
    });
    expect(await settingsFailureRetriever.query({ projectId, query: 'guide', topK: 1, minScore: 0 })).toEqual(
      settingsFailure,
    );
    expect(await settingsFailureRetriever.searchKnowledge(projectId, { query: 'guide' })).toEqual(settingsFailure);

    const configuredSettings = { get: () => Promise.resolve({ ok: true as const, value: settings }) };
    const embeddingFailureRetriever = new Retriever({
      documents: repository,
      vectors: new MemoryVectorStore(),
      settings: configuredSettings,
      embeddings: { embed: () => Promise.resolve(settingsFailure) },
    });
    expect(await embeddingFailureRetriever.query({ projectId, query: 'guide', topK: 1, minScore: 0 })).toEqual(
      settingsFailure,
    );

    const emptyStore = new MemoryVectorStore();
    const baseDependencies = {
      documents: repository,
      vectors: emptyStore,
      settings: configuredSettings,
      embeddings: {
        embed: (texts: readonly string[]) => Promise.resolve({ ok: true as const, value: texts.map(() => [1, 0]) }),
      },
    };
    const retriever = new Retriever(baseDependencies);
    expect(await retriever.query({ projectId, query: 'guide', topK: 1, minScore: 0 })).toEqual({ ok: true, value: [] });
    expect(await retriever.query({ projectId, query: 'guide', topK: 1, minScore: 0, tagFilter: ['missing'] })).toEqual({
      ok: true,
      value: [],
    });

    const emptyEmbeddingRetriever = new Retriever({
      ...baseDependencies,
      embeddings: { embed: () => Promise.resolve({ ok: true as const, value: [] }) },
    });
    expect(await emptyEmbeddingRetriever.query({ projectId, query: 'guide', topK: 1, minScore: 0 })).toMatchObject({
      ok: false,
      error: { code: ErrorCode.VALIDATION },
    });

    const searchFailureRetriever = new Retriever({
      ...baseDependencies,
      vectors: Object.assign(new MemoryVectorStore(), {
        search: () => Promise.resolve(settingsFailure),
      }),
    });
    expect(await searchFailureRetriever.query({ projectId, query: 'guide', topK: 1, minScore: 0 })).toEqual(
      settingsFailure,
    );
  });
});
