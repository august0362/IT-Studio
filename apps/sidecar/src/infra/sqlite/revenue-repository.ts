import { and, desc, eq, gte, lt } from 'drizzle-orm';
import type { RevenueEntry } from '@itstudio/schemas';
import type { AppDatabase } from './database.js';
import { revenueEntries } from './schema.js';
import type { IRevenueRepository, RevenueRange } from '../../ports/revenue-repository.js';
import { revenueEntrySchema } from '../../validation/cost.js';

export class RevenueRepository implements IRevenueRepository {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  insert(entry: RevenueEntry): Promise<void> {
    this.db
      .insert(revenueEntries)
      .values({
        id: entry.id,
        projectId: entry.projectId,
        occurredAt: entry.occurredAt,
        amountMicroUsd: entry.amountMicroUsd,
        enteredCurrency: entry.enteredCurrency,
        description: entry.description,
      })
      .run();
    return Promise.resolve();
  }

  list(range: RevenueRange): Promise<readonly RevenueEntry[]> {
    const rows = this.db
      .select()
      .from(revenueEntries)
      .where(
        and(
          eq(revenueEntries.projectId, range.projectId),
          gte(revenueEntries.occurredAt, range.from),
          lt(revenueEntries.occurredAt, range.to),
        ),
      )
      .orderBy(desc(revenueEntries.occurredAt), desc(revenueEntries.id))
      .all();
    return Promise.resolve(rows.map((row) => revenueEntrySchema.parse(row)));
  }
}
