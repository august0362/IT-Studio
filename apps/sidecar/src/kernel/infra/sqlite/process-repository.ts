import { asc, eq } from 'drizzle-orm';
import type { ProcessId } from '@itstudio/schemas';
import type { IProcessRepository, StoredProcess } from '../../ports/process-tracker.js';
import type { AppDatabase } from './database.js';
import { processes } from './schema.js';
import { processRecordSchema } from '../../validation/process.js';
import { processOperationSchema } from '../../validation/process-operation.js';

export class ProcessRepository implements IProcessRepository {
  private readonly db: AppDatabase;
  constructor(db: AppDatabase) {
    this.db = db;
  }
  load(): readonly StoredProcess[] {
    return this.db
      .select()
      .from(processes)
      .orderBy(asc(processes.updatedAt), asc(processes.rowOrder))
      .all()
      .map((row) => ({
        sequence: row.rowOrder,
        process: processRecordSchema.parse(JSON.parse(row.recordJson) as unknown),
        ...(row.operationJson === null
          ? {}
          : { operation: processOperationSchema.parse(JSON.parse(row.operationJson) as unknown) }),
      }));
  }
  save(records: readonly StoredProcess[], removed: readonly ProcessId[]): void {
    this.db.transaction((tx) => {
      for (const id of removed) tx.delete(processes).where(eq(processes.id, id)).run();
      for (const { process, operation, sequence } of records) {
        const values = {
          rowOrder: sequence,
          id: process.id,
          projectId: process.projectId ?? null,
          status: process.status,
          updatedAt: process.updatedAt,
          recordJson: JSON.stringify(process),
          operationJson: operation === undefined ? null : JSON.stringify(operation),
        };
        tx.insert(processes).values(values).onConflictDoUpdate({ target: processes.id, set: values }).run();
      }
    });
  }
}
