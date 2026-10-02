import { and, desc, eq, gte, inArray, lt, lte, or, type SQL } from 'drizzle-orm';
import type { LedgerEntry, LedgerQuery, Page } from '@itstudio/schemas';
import type { AppDatabase } from './database.js';
import { ledgerEntries } from './schema.js';
import type { ILedgerRepository, LedgerCursor } from '../../ports/ledger-repository.js';
import { ledgerEntrySchema } from '../../validation/cost.js';
import { tokenUsageSchema } from '../../validation/chat.js';

export class LedgerRepository implements ILedgerRepository {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  insert(entry: LedgerEntry): Promise<void> {
    this.db
      .insert(ledgerEntries)
      .values({
        id: entry.id,
        projectId: entry.projectId,
        occurredAt: entry.occurredAt,
        purpose: entry.purpose,
        modelKey: entry.modelKey,
        llmRequestId: entry.llmRequestId ?? null,
        pipelineRunId: entry.pipelineRunId ?? null,
        conversationId: entry.conversationId ?? null,
        usageJson: JSON.stringify(entry.usage),
        imageCount: entry.imageCount ?? null,
        costMicroUsd: entry.costMicroUsd,
        priceTableVersion: entry.priceTableVersion,
        billedFailure: entry.billedFailure ? 1 : 0,
      })
      .run();
    return Promise.resolve();
  }

  query(query: LedgerQuery, cursor: LedgerCursor | undefined, limit: number): Promise<Page<LedgerEntry>> {
    const filters: SQL[] = [eq(ledgerEntries.projectId, query.projectId)];
    if (query.from !== undefined) filters.push(gte(ledgerEntries.occurredAt, query.from));
    if (query.to !== undefined) filters.push(lte(ledgerEntries.occurredAt, query.to));
    if (query.purposes !== undefined && query.purposes.length > 0)
      filters.push(inArray(ledgerEntries.purpose, [...query.purposes]));
    if (query.modelKeys !== undefined && query.modelKeys.length > 0)
      filters.push(inArray(ledgerEntries.modelKey, [...query.modelKeys]));
    if (cursor !== undefined) {
      const cursorFilter = or(
        lt(ledgerEntries.occurredAt, cursor.occurredAt),
        and(eq(ledgerEntries.occurredAt, cursor.occurredAt), lt(ledgerEntries.id, cursor.id)),
      );
      if (cursorFilter !== undefined) filters.push(cursorFilter);
    }
    const rows = this.db
      .select()
      .from(ledgerEntries)
      .where(and(...filters))
      .orderBy(desc(ledgerEntries.occurredAt), desc(ledgerEntries.id))
      .limit(limit + 1)
      .all();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) =>
      ledgerEntrySchema.parse({
        id: row.id,
        projectId: row.projectId,
        occurredAt: row.occurredAt,
        purpose: row.purpose,
        modelKey: row.modelKey,
        ...(row.llmRequestId === null ? {} : { llmRequestId: row.llmRequestId }),
        ...(row.pipelineRunId === null ? {} : { pipelineRunId: row.pipelineRunId }),
        ...(row.conversationId === null ? {} : { conversationId: row.conversationId }),
        usage: tokenUsageSchema.parse(parseJson(row.usageJson)),
        ...(row.imageCount === null ? {} : { imageCount: row.imageCount }),
        costMicroUsd: row.costMicroUsd,
        priceTableVersion: row.priceTableVersion,
        billedFailure: row.billedFailure === 1,
      }),
    );
    const last = items.at(-1);
    return Promise.resolve({
      items,
      nextCursor: hasMore && last !== undefined ? encodeCursor(last.occurredAt, last.id) : null,
    });
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (cause) {
    throw new Error('Stored ledger usage JSON is invalid', { cause });
  }
}

function encodeCursor(occurredAt: string, id: string): string {
  return Buffer.from(`${occurredAt}|${id}`, 'utf8').toString('base64url');
}
