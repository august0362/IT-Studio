import type { FxRate, PriceTable } from '@itstudio/schemas';

/** Temporary seed-backed price and FX source; replaced by pricing/FX services later. */
export interface IPriceSource {
  getPriceTable(): PriceTable;
  getFxRate(): FxRate;
}

export class SeedPriceSource implements IPriceSource {
  private readonly table: PriceTable;
  private readonly fx: FxRate;

  constructor(table: PriceTable, fx: FxRate) {
    this.table = table;
    this.fx = fx;
  }

  getPriceTable(): PriceTable {
    return this.table;
  }

  getFxRate(): FxRate {
    return this.fx;
  }
}
