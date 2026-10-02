import type { LedgerEntry, LedgerQuery, Page } from '@itstudio/schemas';

/** Insert-only persistence and read access for the cost ledger. */
export interface ILedgerRepository {
  insert(entry: LedgerEntry): Promise<void>;
  query(query: LedgerQuery, cursor: LedgerCursor | undefined, limit: number): Promise<Page<LedgerEntry>>;
}

export interface LedgerCursor {
  readonly occurredAt: string;
  readonly id: string;
}
