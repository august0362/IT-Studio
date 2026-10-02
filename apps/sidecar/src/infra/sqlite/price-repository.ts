import { desc } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDatabase } from './database.js';
import { priceTables } from './schema.js';
import type { IPriceRepository, StoredPriceTable } from '../../ports/price-repository.js';
import { isoDateTimeSchema, modelKeySchema, priceTableVersionSchema } from '../../validation/common.js';
import { priceEntrySchema } from '../../validation/cost.js';

export class PriceRepository implements IPriceRepository {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  current(): StoredPriceTable | null {
    const row = this.db.select().from(priceTables).orderBy(desc(priceTables.effectiveFrom)).limit(1).get();
    if (row === undefined) return null;
    let metadata: unknown;
    try {
      metadata = JSON.parse(row.entriesJson) as unknown;
    } catch (cause) {
      throw new Error('Stored price table JSON is invalid', { cause });
    }
    const parsed = entriesMetadataSchema.parse(metadata);
    return {
      version: priceTableVersionSchema.parse(row.version),
      effectiveFrom: isoDateTimeSchema.parse(row.effectiveFrom),
      origin: z.enum(['seed', 'auto_extracted', 'manual_override']).parse(row.origin),
      entries: parsed.entries,
      manualOverrides: parsed.manualOverrides,
    };
  }

  insert(table: StoredPriceTable): void {
    this.db
      .insert(priceTables)
      .values({
        version: table.version,
        effectiveFrom: table.effectiveFrom,
        origin: table.origin,
        entriesJson: JSON.stringify({ entries: table.entries, manualOverrides: table.manualOverrides }),
      })
      .run();
  }
}

const entriesMetadataSchema = z.object({
  entries: z.array(priceEntrySchema),
  manualOverrides: z.array(modelKeySchema),
});
