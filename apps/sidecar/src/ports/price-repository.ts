import type { ModelKey, PriceTable } from '@itstudio/schemas';

export interface StoredPriceTable extends PriceTable {
  readonly manualOverrides: readonly ModelKey[];
}

export interface IPriceRepository {
  current(): StoredPriceTable | null;
  insert(table: StoredPriceTable): void;
}
