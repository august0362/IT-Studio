import { ErrorCode, type AppError, type FxRate, type Result } from '@itstudio/schemas';
import type { Logger } from 'pino';
import type { IClock } from '../infra/clock.js';
import type { IHttpClient } from '../ports/http-client.js';
import type { IFxRepository } from '../ports/fx-repository.js';
import type { SettingsService } from './settings-service.js';
import { fxRateSchema } from '../validation/cost.js';
import { isoDateTimeSchema } from '../validation/brand.js';

export const MIN_USD_TO_VND = 10_000;
export const MAX_USD_TO_VND = 100_000;
const TIMEOUT_MS = 10_000;
const MAX_AUTO_CHANGE = 0.2;

export interface FxConfig {
  readonly sourceUrl: string;
  readonly vndField: string;
  readonly seedUsdToVnd: number;
  readonly seedAsOf: string;
}

export interface FxServiceDependencies {
  readonly repository: IFxRepository;
  readonly http: IHttpClient;
  readonly settings: SettingsService;
  readonly config: FxConfig;
  readonly clock: IClock;
  readonly logger: Logger;
}

export class FxService {
  private readonly deps: FxServiceDependencies;
  private readonly seed: FxRate;
  private effective: FxRate;

  constructor(dependencies: FxServiceDependencies) {
    this.deps = dependencies;
    this.seed = fxRateSchema.parse({
      usdToVnd: dependencies.config.seedUsdToVnd,
      asOf: dependencies.config.seedAsOf,
      source: 'auto',
    });
    this.effective = this.seed;
  }

  async initialize(): Promise<Result<FxRate>> {
    const settings = await this.deps.settings.get();
    if (!settings.ok) return settings;
    const latest = this.deps.repository.latestAuto();
    this.effective =
      settings.value.fx.manualUsdToVnd === null
        ? (latest ?? this.seed)
        : this.manualRate(settings.value.fx.manualUsdToVnd);
    return { ok: true, value: this.effective };
  }

  get(): Promise<Result<FxRate>> {
    return Promise.resolve({ ok: true, value: this.effective });
  }

  getEffective(): FxRate {
    return this.effective;
  }

  latestAuto(): FxRate | null {
    return this.deps.repository.latestAuto();
  }

  async override(usdToVnd: number | null): Promise<Result<FxRate>> {
    if (usdToVnd !== null && (!Number.isFinite(usdToVnd) || usdToVnd < MIN_USD_TO_VND || usdToVnd > MAX_USD_TO_VND))
      return validationFailure('USD to VND rate must be between 10,000 and 100,000.');
    const updated = await this.deps.settings.update({ fx: { manualUsdToVnd: usdToVnd } });
    if (!updated.ok) return updated;
    this.effective = usdToVnd === null ? (this.deps.repository.latestAuto() ?? this.seed) : this.manualRate(usdToVnd);
    return { ok: true, value: this.effective };
  }

  async update(): Promise<Result<FxRate>> {
    try {
      const response = await this.deps.http.request(this.deps.config.sourceUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return this.fetchFailure(`FX provider returned HTTP ${String(response.status)}.`);
      const body: unknown = await response.json();
      const rate = readNumberAtPath(body, this.deps.config.vndField);
      if (rate === null) return this.fetchFailure('FX provider response did not contain a numeric VND rate.');
      if (rate < MIN_USD_TO_VND || rate > MAX_USD_TO_VND)
        return this.fetchFailure('FX provider rate was outside the allowed range.');
      const previous = this.deps.repository.latestAuto();
      if (previous !== null && Math.abs(rate - previous.usdToVnd) / previous.usdToVnd > MAX_AUTO_CHANGE)
        return this.fetchFailure('FX provider rate changed by more than 20 percent.');
      const stored = fxRateSchema.parse({
        usdToVnd: rate,
        asOf: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
        source: 'auto',
      });
      this.deps.repository.insert(stored);
      const settings = await this.deps.settings.get();
      if (!settings.ok) return settings;
      this.effective =
        settings.value.fx.manualUsdToVnd === null
          ? stored
          : this.effective.source === 'manual_override' && this.effective.usdToVnd === settings.value.fx.manualUsdToVnd
            ? this.effective
            : this.manualRate(settings.value.fx.manualUsdToVnd);
      return { ok: true, value: this.effective };
    } catch (error) {
      const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return this.fetchFailure(
        timeout ? 'FX provider request timed out.' : 'FX provider response could not be read.',
        timeout,
      );
    }
  }

  private fetchFailure(message: string, retryable = false): Result<never> {
    const error: AppError = {
      code: retryable ? ErrorCode.PROVIDER_TIMEOUT : ErrorCode.PROVIDER_SERVER,
      message,
      retryable,
      remediation: ['Check the exchange rate service and try again later.'],
    };
    this.deps.logger.warn({ svc: 'fx', error: message }, 'FX rate update rejected');
    return { ok: false, error };
  }

  private manualRate(usdToVnd: number): FxRate {
    return {
      usdToVnd,
      asOf: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
      source: 'manual_override',
    };
  }
}

function readNumberAtPath(value: unknown, path: string): number | null {
  let current = value;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return null;
    if (!isRecord(current)) return null;
    current = current[segment];
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validationFailure(message: string): Result<never> {
  return {
    ok: false,
    error: {
      code: ErrorCode.VALIDATION,
      message,
      retryable: false,
      remediation: ['Enter a rate between 10,000 and 100,000, or clear the override.'],
    },
  };
}
