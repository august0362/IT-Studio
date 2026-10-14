import { ErrorCode, type AppError, type Result } from '@itstudio/schemas';
import type { VectorChunkRow, VectorSearchOptions } from '../ports/vector-store.js';

export function validId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validRows(table: string, rows: readonly VectorChunkRow[]): boolean {
  return rows.every(
    (row) =>
      validId(row.chunkId) &&
      validId(row.documentId) &&
      row.projectId === table &&
      Number.isInteger(row.ordinal) &&
      row.ordinal >= 0 &&
      row.vector.length > 0 &&
      Array.from(row.vector).every(Number.isFinite),
  );
}

export function validSearch(vector: ArrayLike<number>, options: VectorSearchOptions): boolean {
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

export function dimensionFailure<T>(): Result<T> {
  return failure(ErrorCode.VALIDATION, 'Embedding dimension changed; re-index required.', [
    'Re-index this project with one embedding dimension.',
  ]);
}

export function invalidId<T>(): Result<T> {
  return failure(ErrorCode.VALIDATION, 'Vector store identifiers must be UUIDs.', [
    'Use valid project, document, and chunk ids.',
  ]);
}

export function internalFailure<T>(error: unknown): Result<T> {
  return failure(ErrorCode.INTERNAL, error instanceof Error ? error.message : 'Vector database operation failed.', [
    'Check the vector database files and retry.',
  ]);
}

export function failure<T>(code: AppError['code'], message: string, remediation: readonly string[]): Result<T> {
  return { ok: false, error: { code, message, retryable: false, remediation } };
}

export function success<T>(value: T): Result<T> {
  return { ok: true, value };
}
