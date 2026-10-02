import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LanceDbVectorStore } from './vector-store.js';
import type { VectorChunkRow, VectorSearchOptions } from '../../ports/vector-store.js';
import { vectorStoreContract } from '../__contract__/vector-store-contract.js';

let directory = '';
let store: LanceDbVectorStore;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'itstudio-vectors-'));
  store = new LanceDbVectorStore(directory);
});

afterAll(async () => {
  if (directory !== '') await rm(directory, { recursive: true, force: true });
});

vectorStoreContract('LanceDB', {
  upsertChunks: (table: string, rows: readonly VectorChunkRow[]) => store.upsertChunks(table, rows),
  deleteByDocument: (table: string, documentId: string) => store.deleteByDocument(table, documentId),
  search: (table: string, vector: Float32Array | readonly number[], options: VectorSearchOptions) =>
    store.search(table, vector, options),
  dropTable: (table: string) => store.dropTable(table),
  count: (table: string) => store.count(table),
});

describe('LanceDB vector store error paths', () => {
  it('TC-M5-VS-001 returns an empty result when the table does not exist', async () => {
    const result = await store.search('00000000-0000-4000-8000-000000000099', [1, 0], { topK: 3, minScore: 0 });
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('TC-M5-VS-002 rejects a vector whose dimension differs from the existing table', async () => {
    const projectId = '00000000-0000-4000-8000-000000000098';
    const row: VectorChunkRow = {
      chunkId: '00000000-0000-4000-8000-000000000097',
      documentId: '00000000-0000-4000-8000-000000000096',
      projectId,
      ordinal: 0,
      text: 'dimension fixture',
      sectionPath: ['fixture'],
      vector: [1, 0],
      tags: [],
    };
    const inserted = await store.upsertChunks(projectId, [row]);
    expect(inserted).toEqual({ ok: true, value: undefined });
    const result = await store.upsertChunks(projectId, [{ ...row, vector: [1, 0, 0] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION');
      expect(result.error.message.toLowerCase()).toContain('dimension');
    }
  });

  it('TC-M5-VS-003 rejects invalid searches and rows and returns empty filtered searches', async () => {
    const projectId = '00000000-0000-4000-8000-000000000095';
    const row: VectorChunkRow = {
      chunkId: '00000000-0000-4000-8000-000000000094',
      documentId: '00000000-0000-4000-8000-000000000093',
      projectId,
      ordinal: 0,
      text: 'filter fixture',
      sectionPath: ['filter'],
      vector: [1, 0],
      tags: ['fixture'],
    };
    const invalidId = await store.search('bad-id', [1, 0], { topK: 1, minScore: 0 });
    expect(invalidId).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    const invalidOptions = await store.search(projectId, [1, 0], { topK: 0, minScore: 0 });
    expect(invalidOptions).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect((await store.upsertChunks(projectId, [row])).ok).toBe(true);
    expect(await store.search(projectId, [1, 0], { topK: 1, minScore: 0, documentIds: [] })).toEqual({
      ok: true,
      value: [],
    });
    expect(await store.search(projectId, [1, 0], { topK: 1, minScore: 0, tagFilter: [] })).toEqual({
      ok: true,
      value: [],
    });
    expect(await store.upsertChunks(projectId, [{ ...row, ordinal: -1 }])).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  it('TC-M5-VS-004 returns a structured error when the LanceDB directory is unusable', async () => {
    const filePath = join(directory, 'not-a-directory');
    await writeFile(filePath, 'file blocks directory creation');
    const unavailable = new LanceDbVectorStore(filePath);
    const result = await unavailable.count('00000000-0000-4000-8000-000000000092');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL');
      expect(result.error.remediation?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
