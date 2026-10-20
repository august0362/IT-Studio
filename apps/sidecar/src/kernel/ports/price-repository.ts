import type { ModelKey, PriceEntry, PriceTable } from '@itstudio/schemas';

export interface StoredPriceTable extends PriceTable {
  readonly manualOverrides: readonly ModelKey[];
  /** Last known non-manual prices, including rows currently hidden by overrides. Absent in legacy JSON. */
  readonly automaticEntries?: readonly PriceEntry[];
}

export interface IPriceRepository {
  current(): StoredPriceTable | null;
  insert(table: StoredPriceTable): void;
}
