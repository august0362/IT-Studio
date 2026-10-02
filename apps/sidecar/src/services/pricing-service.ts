import {
  ErrorCode,
  type AppError,
  type ModelKey,
  type PriceEntry,
  type PriceTable,
  type PriceTableVersion,
  type Result,
} from '@itstudio/schemas';
import type { IClock } from '../infra/clock.js';
import type { IIdGenerator } from '../infra/id.js';
import type { IPriceRepository, StoredPriceTable } from '../ports/price-repository.js';
import { isoDateTimeSchema, modelKeySchema, priceTableVersionSchema } from '../validation/common.js';
import { priceEntrySchema } from '../validation/cost.js';

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export interface PricingServiceDependencies {
  readonly repository: IPriceRepository;
  readonly seed: PriceTable;
  readonly knownModels: ReadonlySet<ModelKey>;
  readonly ids: IIdGenerator;
  readonly clock: IClock;
}

export class PricingService {
  private readonly repository: IPriceRepository;
  private readonly seed: PriceTable;
  private readonly knownModels: ReadonlySet<ModelKey>;
  private readonly ids: IIdGenerator;
  private readonly clock: IClock;

  constructor(dependencies: PricingServiceDependencies) {
    this.repository = dependencies.repository;
    this.seed = dependencies.seed;
    this.knownModels = dependencies.knownModels;
    this.ids = dependencies.ids;
    this.clock = dependencies.clock;
  }

  initialize(): void {
    if (this.repository.current() !== null) return;
    this.repository.insert({ ...this.seed, manualOverrides: [] });
  }

  current(): PriceTable {
    const current = this.requireCurrent();
    return toPriceTable(current);
  }

  isStale(now = this.clock.now()): boolean {
    const effectiveFrom = Date.parse(this.requireCurrent().effectiveFrom);
    return now.getTime() - effectiveFrom >= STALE_AFTER_MS;
  }

  override(entry: PriceEntry): Result<PriceTable> {
    const parsed = priceEntrySchema.safeParse(entry);
    if (!parsed.success) return validationError('Price entry failed validation.');
    if (!this.knownModels.has(parsed.data.modelKey)) return validationError('Price entry refers to an unknown model.');
    const current = this.requireCurrent();
    const entries = current.entries.map((existing) =>
      existing.modelKey === parsed.data.modelKey ? parsed.data : existing,
    );
    if (!current.entries.some((existing) => existing.modelKey === parsed.data.modelKey)) entries.push(parsed.data);
    const manualOverrides = new Set(current.manualOverrides);
    manualOverrides.add(parsed.data.modelKey);
    return { ok: true, value: this.insertVersion(current, entries, [...manualOverrides]) };
  }

  clearOverride(modelKey: ModelKey): Result<PriceTable> {
    const parsedKey = modelKeySchema.safeParse(modelKey);
    if (!parsedKey.success || !this.knownModels.has(parsedKey.data))
      return validationError('Cannot clear an override for an unknown model.');
    const current = this.requireCurrent();
    const manualOverrides = current.manualOverrides.filter((key) => key !== parsedKey.data);
    if (manualOverrides.length === current.manualOverrides.length) return { ok: true, value: this.current() };
    return { ok: true, value: this.insertVersion(current, current.entries, manualOverrides) };
  }

  private requireCurrent(): StoredPriceTable {
    const current = this.repository.current();
    if (current === null) throw new Error('PricingService.initialize must run before use');
    return current;
  }

  private insertVersion(
    previous: StoredPriceTable,
    entries: readonly PriceEntry[],
    manualOverrides: readonly ModelKey[],
  ): PriceTable {
    const now = this.clock.now();
    const priorTime = Date.parse(previous.effectiveFrom);
    const effectiveFrom = isoDateTimeSchema.parse(new Date(Math.max(now.getTime(), priorTime + 1)).toISOString());
    const version: PriceTableVersion = priceTableVersionSchema.parse(`manual-${this.ids.uuid()}`);
    const next: StoredPriceTable = {
      version,
      effectiveFrom,
      origin: 'manual_override',
      entries: [...entries],
      manualOverrides: [...manualOverrides],
    };
    this.repository.insert(next);
    return toPriceTable(next);
  }
}

function toPriceTable(table: StoredPriceTable): PriceTable {
  return {
    version: table.version,
    effectiveFrom: table.effectiveFrom,
    origin: table.origin,
    entries: table.entries,
  };
}

function validationError(message: string): Result<never> {
  const error: AppError = {
    code: ErrorCode.VALIDATION,
    message,
    retryable: false,
    remediation: ['Review the model and non-negative integer prices, then try again.'],
  };
  return { ok: false, error };
}
