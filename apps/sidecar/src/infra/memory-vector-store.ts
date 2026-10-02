import { ErrorCode, type AppError, type Result } from '@itstudio/schemas';
import type { IVectorStore, VectorChunkRow, VectorSearchHit, VectorSearchOptions } from '../ports/vector-store.js';

interface StoredRow extends VectorChunkRow {
  readonly vector: readonly number[];
}

export class MemoryVectorStore implements IVectorStore {
  private readonly tables = new Map<string, Map<string, StoredRow>>();
  private readonly dimensions = new Map<string, number>();

  upsertChunks(table: string, rows: readonly VectorChunkRow[]): Promise<Result<void>> {
    if (!validTable(table))
      return Promise.resolve(
        failure(ErrorCode.VALIDATION, 'Table must be a project UUID.', ['Use a valid project id.']),
      );
    const validation = validRows(table, rows);
    if (validation !== undefined) return Promise.resolve(validation);
    const dimension = this.dimensions.get(table) ?? rows[0]?.vector.length;
    if (dimension !== undefined && rows.some((row) => row.vector.length !== dimension))
      return Promise.resolve(dimensionFailure());
    const target = this.tables.get(table) ?? new Map<string, StoredRow>();
    for (const row of rows)
      target.set(row.chunkId, { ...row, sectionPath: [...row.sectionPath], vector: Array.from(row.vector) });
    this.tables.set(table, target);
    if (dimension !== undefined) this.dimensions.set(table, dimension);
    return Promise.resolve(success(undefined));
  }

  deleteByDocument(table: string, documentId: string): Promise<Result<void>> {
    if (!validTable(table) || !validId(documentId)) return Promise.resolve(invalidId());
    for (const [id, row] of this.tables.get(table) ?? [])
      if (row.documentId === documentId) this.tables.get(table)?.delete(id);
    return Promise.resolve(success(undefined));
  }

  search(
    table: string,
    vector: Float32Array | readonly number[],
    options: VectorSearchOptions,
  ): Promise<Result<readonly VectorSearchHit[]>> {
    if (!validTable(table)) return Promise.resolve(invalidId());
    if (!validSearch(vector, options))
      return Promise.resolve(
        failure(ErrorCode.VALIDATION, 'Vector search parameters are invalid.', [
          'Use a non-empty vector, topK above zero, and a score from 0 to 1.',
        ]),
      );
    if ((this.dimensions.get(table) ?? vector.length) !== vector.length && (this.tables.get(table)?.size ?? 0) > 0)
      return Promise.resolve(dimensionFailure());
    const documentIds = options.documentIds;
    if (documentIds?.some((id) => !validId(id))) return Promise.resolve(invalidId());
    const hits = Array.from(this.tables.get(table)?.values() ?? [])
      .filter((row) => documentIds === undefined || documentIds.includes(row.documentId))
      .filter((row) => options.tagFilter === undefined || options.tagFilter.some((tag) => row.tags?.includes(tag)))
      .map((row) => ({ row, score: cosine(row.vector, vector) }))
      .filter(({ score }) => score >= options.minScore)
      .sort((a, b) => b.score - a.score || a.row.ordinal - b.row.ordinal || a.row.chunkId.localeCompare(b.row.chunkId))
      .slice(0, options.topK)
      .map(({ row, score }): VectorSearchHit => ({
        chunkId: row.chunkId,
        documentId: row.documentId,
        text: row.text,
        sectionPath: row.sectionPath,
        score,
      }));
    return Promise.resolve(success(hits));
  }

  dropTable(table: string): Promise<Result<void>> {
    if (!validTable(table)) return Promise.resolve(invalidId());
    this.tables.delete(table);
    this.dimensions.delete(table);
    return Promise.resolve(success(undefined));
  }

  count(table: string): Promise<Result<number>> {
    if (!validTable(table)) return Promise.resolve(invalidId());
    return Promise.resolve(success(this.tables.get(table)?.size ?? 0));
  }
}

export function cosine(left: ArrayLike<number>, right: ArrayLike<number>): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))));
}

export function validId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validTable(table: string): boolean {
  return validId(table);
}
function validRows(table: string, rows: readonly VectorChunkRow[]): Result<void> | undefined {
  if (
    !rows.every(
      (row) =>
        validId(row.chunkId) &&
        validId(row.documentId) &&
        row.projectId === table &&
        Number.isInteger(row.ordinal) &&
        row.ordinal >= 0 &&
        row.vector.length > 0 &&
        Array.from(row.vector).every(Number.isFinite),
    )
  )
    return invalidId();
  return undefined;
}
function validSearch(vector: ArrayLike<number>, options: VectorSearchOptions): boolean {
  return (
    vector.length > 0 &&
    Array.from(vector).every(Number.isFinite) &&
    Number.isInteger(options.topK) &&
    options.topK > 0 &&
    Number.isFinite(options.minScore) &&
    options.minScore >= 0 &&
    options.minScore <= 1
  );
}
function dimensionFailure<T>(): Result<T> {
  return failure(ErrorCode.VALIDATION, 'Embedding dimension changed; re-index required.', [
    'Re-index this project with one embedding dimension.',
  ]);
}
function invalidId<T>(): Result<T> {
  return failure(ErrorCode.VALIDATION, 'Vector store identifiers must be UUIDs.', [
    'Use valid project, document, and chunk ids.',
  ]);
}
function failure<T>(code: AppError['code'], message: string, remediation: readonly string[]): Result<T> {
  return { ok: false, error: { code, message, retryable: false, remediation } };
}
function success<T>(value: T): Result<T> {
  return { ok: true, value };
}
