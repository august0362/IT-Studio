import type { FxRate, PriceTable } from '@itstudio/schemas';
import type { IPriceRepository } from '../ports/price-repository.js';
import type { FxService } from './fx-service.js';

export interface IPriceSource {
  getPriceTable(): PriceTable;
  getFxRate(): FxRate;
}

export class RepositoryPriceSource implements IPriceSource {
  private readonly repository: IPriceRepository;
  private readonly fx: FxService;

  constructor(repository: IPriceRepository, fx: FxService) {
    this.repository = repository;
    this.fx = fx;
  }

  getPriceTable(): PriceTable {
    const current = this.repository.current();
    if (current === null) throw new Error('The pricing table has not been seeded');
    return {
      version: current.version,
      effectiveFrom: current.effectiveFrom,
      origin: current.origin,
      entries: current.entries,
    };
  }

  getFxRate(): FxRate {
    return this.fx.getEffective();
  }
}
