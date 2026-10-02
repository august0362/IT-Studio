import { connect, type Connection } from '@lancedb/lancedb';
import { z } from 'zod';
import { ErrorCode, type AppError, type Result } from '@itstudio/schemas';
import type { IVectorStore, VectorChunkRow, VectorSearchHit, VectorSearchOptions } from '../../ports/vector-store.js';
import { validId } from '../memory-vector-store.js';

interface LanceRow extends VectorChunkRow, Record<string, unknown> {
  readonly vector: number[];
  readonly tags: readonly string[];
}

export class LanceDbVectorStore implements IVectorStore {
  private connection: Promise<Connection> | undefined;
  private readonly dimensions = new Map<string, number>();
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async upsertChunks(table: string, rows: readonly VectorChunkRow[]): Promise<Result<void>> {
    const invalid = validateRows(table, rows);
    if (invalid !== undefined) return invalid;
    if (rows.length === 0) return success(undefined);
    try {
      const dimension = await this.dimension(table);
      if (dimension !== undefined && rows.some((row) => row.vector.length !== dimension)) return dimensionFailure();
      const records = rows.map(toLanceRow);
      const db = await this.db();
      const existing = await this.tableExists(db, tableName(table));
      if (!existing) await db.createTable(tableName(table), records);
      else
        await (
          await db.openTable(tableName(table))
        )
          .mergeInsert('chunkId')
          .whenMatchedUpdateAll()
          .whenNotMatchedInsertAll()
          .execute(records);
      this.dimensions.set(table, rows[0]?.vector.length ?? 0);
      return success(undefined);
    } catch (error) {
      return internalFailure(error);
    }
  }

  async deleteByDocument(table: string, documentId: string): Promise<Result<void>> {
    if (!validId(table) || !validId(documentId)) return invalidId();
    try {
      const db = await this.db();
      if (await this.tableExists(db, tableName(table)))
        await (await db.openTable(tableName(table))).delete(`documentId = '${documentId}'`);
      return success(undefined);
    } catch (error) {
      return internalFailure(error);
    }
  }

  async search(
    table: string,
    vector: Float32Array | readonly number[],
    options: VectorSearchOptions,
  ): Promise<Result<readonly VectorSearchHit[]>> {
    if (!validId(table) || !validSearch(vector, options) || options.documentIds?.some((id) => !validId(id)))
      return invalidId();
    try {
      const db = await this.db();
      if (!(await this.tableExists(db, tableName(table)))) return success([]);
      const dimension = await this.dimension(table);
      if (dimension !== undefined && vector.length !== dimension) return dimensionFailure();
      const where = buildFilter(options);
      if (where.empty) return success([]);
      let query = (await db.openTable(tableName(table))).query().nearestTo(Array.from(vector)).distanceType('cosine');
      if (where.sql !== undefined) query = query.where(where.sql);
      const rows: unknown[] = await query.limit(options.topK).toArray();
      const hits = rows
        .map(parseHit)
        .filter((hit): hit is VectorSearchHit => hit !== undefined && hit.score >= options.minScore);
      return success(hits);
    } catch (error) {
      return internalFailure(error);
    }
  }

  async dropTable(table: string): Promise<Result<void>> {
    if (!validId(table)) return invalidId();
    try {
      const db = await this.db();
      if (await this.tableExists(db, tableName(table))) await db.dropTable(tableName(table));
      this.dimensions.delete(table);
      return success(undefined);
    } catch (error) {
      return internalFailure(error);
    }
  }

  async count(table: string): Promise<Result<number>> {
    if (!validId(table)) return invalidId();
    try {
      const db = await this.db();
      return success(
        (await this.tableExists(db, tableName(table))) ? await (await db.openTable(tableName(table))).countRows() : 0,
      );
    } catch (error) {
      return internalFailure(error);
    }
  }

  private async db(): Promise<Connection> {
    this.connection ??= connect(`${this.dataDir.replace(/[\\/]$/, '')}/vectors`);
    return this.connection;
  }

  private async tableExists(db: Connection, name: string): Promise<boolean> {
    return (await db.listTables()).tables.includes(name);
  }

  private async dimension(projectId: string): Promise<number | undefined> {
    const cached = this.dimensions.get(projectId);
    if (cached !== undefined) return cached;
    const db = await this.db();
    const name = tableName(projectId);
    if (!(await this.tableExists(db, name))) return undefined;
    const rows: unknown[] = await (await db.openTable(name)).query().select(['vector']).limit(1).toArray();
    const first = rows[0];
    if (typeof first !== 'object' || first === null || !('vector' in first)) return undefined;
    const vector = arrayValues(first.vector);
    if (vector === undefined) return undefined;
    const dimension = vector.length;
    this.dimensions.set(projectId, dimension);
    return dimension;
  }
}

function toLanceRow(row: VectorChunkRow): LanceRow {
  const tags = row.tags ?? [];
  return {
    ...row,
    sectionPath: [...row.sectionPath],
    vector: Array.from(row.vector),
    tags: tags.length === 0 ? [''] : [...tags],
  };
}

function parseHit(value: unknown): VectorSearchHit | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (
    !('chunkId' in value) ||
    !('documentId' in value) ||
    !('text' in value) ||
    !('sectionPath' in value) ||
    !('_distance' in value)
  )
    return undefined;
  const row = value;
  if (
    typeof row.chunkId !== 'string' ||
    typeof row.documentId !== 'string' ||
    typeof row.text !== 'string' ||
    stringArray(row.sectionPath) === undefined ||
    typeof row._distance !== 'number' ||
    !Number.isFinite(row._distance)
  )
    return undefined;
  const score = Math.max(0, Math.min(1, 1 - row._distance));
  return {
    chunkId: row.chunkId,
    documentId: row.documentId,
    text: row.text,
    sectionPath: stringArray(row.sectionPath) ?? [],
    score,
  };
}

function arrayValues(value: unknown): readonly unknown[] | undefined {
  const array = z.array(z.unknown()).safeParse(value);
  if (array.success) return array.data;
  const floatArray = z.instanceof(Float32Array).safeParse(value);
  if (floatArray.success) return Array.from(floatArray.data, (item): unknown => item);
  const vector = z
    .object({
      length: z.number().int().nonnegative(),
      get: z.function({ input: [z.number()], output: z.unknown() }),
    })
    .safeParse(value);
  if (!vector.success) return undefined;
  const values: unknown[] = [];
  for (let index = 0; index < vector.data.length; index += 1) values.push(vector.data.get(index));
  return values;
}

function stringArray(value: unknown): readonly string[] | undefined {
  const items = arrayValues(value);
  return items?.every((item) => typeof item === 'string') === true ? items : undefined;
}

function buildFilter(options: VectorSearchOptions): { readonly sql?: string; readonly empty: boolean } {
  const filters: string[] = [];
  if (options.documentIds !== undefined) {
    if (options.documentIds.length === 0) return { empty: true };
    filters.push(`documentId IN (${options.documentIds.map(escapeSql).join(', ')})`);
  }
  if (options.tagFilter !== undefined) {
    if (options.tagFilter.length === 0) return { empty: true };
    filters.push(`list_has_any(tags, [${options.tagFilter.map(escapeSql).join(', ')}])`);
  }
  return filters.length === 0 ? { empty: false } : { sql: filters.join(' AND '), empty: false };
}

function escapeSql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
function tableName(projectId: string): string {
  return `chunks_${projectId}`;
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
function validateRows(table: string, rows: readonly VectorChunkRow[]): Result<void> | undefined {
  if (
    !validId(table) ||
    rows.some(
      (row) =>
        !validId(row.chunkId) ||
        !validId(row.documentId) ||
        row.projectId !== table ||
        !Number.isInteger(row.ordinal) ||
        row.ordinal < 0 ||
        row.vector.length === 0 ||
        Array.from(row.vector).some((value) => !Number.isFinite(value)),
    )
  )
    return invalidId();
  return undefined;
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
function internalFailure<T>(error: unknown): Result<T> {
  return failure(ErrorCode.INTERNAL, error instanceof Error ? error.message : 'Vector database operation failed.', [
    'Check the vector database files and retry.',
  ]);
}
function failure<T>(code: AppError['code'], message: string, remediation: readonly string[]): Result<T> {
  return { ok: false, error: { code, message, retryable: false, remediation } };
}
function success<T>(value: T): Result<T> {
  return { ok: true, value };
}
