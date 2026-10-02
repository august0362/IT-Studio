import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';
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
