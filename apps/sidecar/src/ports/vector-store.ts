import type { Result } from '@itstudio/schemas';

export interface VectorChunkRow {
  readonly chunkId: string;
  readonly documentId: string;
  readonly projectId: string;
  readonly ordinal: number;
  readonly text: string;
  readonly sectionPath: readonly string[];
  readonly vector: Float32Array | readonly number[];
  readonly tags?: readonly string[];
}

export interface VectorSearchOptions {
  readonly topK: number;
  readonly minScore: number;
  readonly documentIds?: readonly string[];
  readonly tagFilter?: readonly string[];
}

export interface VectorSearchHit {
  readonly chunkId: string;
  readonly documentId: string;
  readonly text: string;
  readonly sectionPath: readonly string[];
  readonly score: number;
}

export interface IVectorStore {
  upsertChunks(table: string, rows: readonly VectorChunkRow[]): Promise<Result<void>>;
  deleteByDocument(table: string, documentId: string): Promise<Result<void>>;
  search(
    table: string,
    vector: Float32Array | readonly number[],
    options: VectorSearchOptions,
  ): Promise<Result<readonly VectorSearchHit[]>>;
  dropTable(table: string): Promise<Result<void>>;
  count(table: string): Promise<Result<number>>;
}
