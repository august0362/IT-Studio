import { desc, eq } from 'drizzle-orm';
import type { ProviderId, SecretHistoryEntry } from '@itstudio/schemas';
import type { AppDatabase } from './database.js';
import { secretHistory } from './schema.js';
import { secretHistoryEntrySchema } from '../../validation/models.js';

export interface ISecretHistoryRepository {
  append(entry: SecretHistoryEntry): void;
  list(provider: ProviderId | undefined, limit: number): readonly SecretHistoryEntry[];
}

export class SecretHistoryRepository implements ISecretHistoryRepository {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  append(entry: SecretHistoryEntry): void {
    this.db
      .insert(secretHistory)
      .values({
        id: entry.id,
        provider: entry.provider,
        hint: entry.hint,
        action: entry.action,
        resultCode: entry.resultCode,
        at: entry.at,
      })
      .run();
  }

  list(provider: ProviderId | undefined, limit: number): readonly SecretHistoryEntry[] {
    const query = this.db
      .select()
      .from(secretHistory)
      .orderBy(desc(secretHistory.at), desc(secretHistory.id))
      .limit(limit);
    const rows = provider === undefined ? query.all() : query.where(eq(secretHistory.provider, provider)).all();
    return rows.map((row) =>
      secretHistoryEntrySchema.parse({
        id: row.id,
        provider: row.provider,
        hint: row.hint,
        action: row.action,
        resultCode: row.resultCode,
        at: row.at,
      }),
    );
  }
}
