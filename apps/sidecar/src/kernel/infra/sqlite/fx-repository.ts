import { desc } from 'drizzle-orm';
import type { FxRate } from '@itstudio/schemas';
import type { AppDatabase } from './database.js';
import { fxRates } from './schema.js';
import { fxRateSchema } from '../../validation/cost.js';
import type { IFxRepository } from '../../ports/fx-repository.js';

export class FxRepository implements IFxRepository {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  latestAuto(): FxRate | null {
    const row = this.db.select().from(fxRates).orderBy(desc(fxRates.asOf)).limit(1).get();
    if (row === undefined) return null;
    return fxRateSchema.parse({ usdToVnd: row.usdToVnd, asOf: row.asOf, source: 'auto' });
  }

  insert(rate: FxRate): void {
    if (rate.source !== 'auto') throw new Error('Only automatic FX rates can be stored');
    this.db.insert(fxRates).values({ asOf: rate.asOf, usdToVnd: rate.usdToVnd }).run();
  }
}
