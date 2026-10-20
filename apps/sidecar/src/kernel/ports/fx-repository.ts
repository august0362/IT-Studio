import type { FxRate } from '@itstudio/schemas';

export interface IFxRepository {
  latestAuto(): FxRate | null;
  insert(rate: FxRate): void;
}
