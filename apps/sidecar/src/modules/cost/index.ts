import type { MicroUsd, ModelKey, PriceEntry } from '@itstudio/schemas';
import { microUsd, toMoneyDisplay } from '../../kernel/domain/money.js';
import { FetchHttpClient } from '../../kernel/infra/http/provider-key-verifier.js';
import { BudgetRepository } from '../../kernel/infra/sqlite/budget-repository.js';
import { FxRepository } from '../../kernel/infra/sqlite/fx-repository.js';
import { LedgerRepository } from '../../kernel/infra/sqlite/ledger-repository.js';
import { PriceRepository } from '../../kernel/infra/sqlite/price-repository.js';
import { ProjectRepository } from '../../kernel/infra/sqlite/project-repository.js';
import { RevenueRepository } from '../../kernel/infra/sqlite/revenue-repository.js';
import type { ModuleContext } from '../../kernel/module-context.js';
import type { IHttpClient } from '../../kernel/ports/http-client.js';
import type { IProcessTracker } from '../../kernel/ports/process-tracker.js';
import type { ISecretStore } from '../../kernel/ports/secret-store.js';
import { isoDateTimeSchema } from '../../kernel/validation/brand.js';
import { modelKeySchema } from '../../kernel/validation/common.js';
import type { LlmRouter, ModelCatalog } from '../router/index.js';
import type { SettingsService } from '../settings/index.js';
import { BudgetGuard } from './services/budget-guard.js';
import { FxDailyJob } from './services/daily-job.js';
import { FxService } from './services/fx-service.js';
import { LedgerService } from './services/ledger-service.js';
import { PnLService } from './services/pnl-service.js';
import { RepositoryPriceSource } from './services/price-source.js';
import { PricingService } from './services/pricing-service.js';
import { PricingUpdater } from './services/pricing-updater.js';
import { RevenueService } from './services/revenue-service.js';

export interface CostModuleDependencies {
  readonly settings: SettingsService;
  readonly catalog: ModelCatalog;
  readonly fxHttp?: IHttpClient | undefined;
}

export function createCostModule(ctx: ModuleContext, deps: CostModuleDependencies) {
  const { settings } = deps;
  const { seeds, clock, ids, logger, events } = ctx;
  const ledgerRepository = new LedgerRepository(ctx.db);
  const revenueRepository = new RevenueRepository(ctx.db);
  const priceRepository = new PriceRepository(ctx.db);
  const projects = new ProjectRepository(ctx.db);
  const fx = new FxService({
    repository: new FxRepository(ctx.db),
    http: deps.fxHttp ?? new FetchHttpClient(),
    settings,
    config: seeds.fx,
    clock,
    logger,
  });
  const fxDailyJob = new FxDailyJob({ fx, settings, clock, logger });
  const pricing = new PricingService({
    repository: priceRepository,
    seed: seeds.pricing,
    knownModels: new Set(deps.catalog.models.list().map((model) => model.key)),
    ids,
    clock,
  });
  pricing.initialize();
  if (ctx.e2e && ctx.env.ITSTUDIO_E2E_IMAGE_PRICE_MICRO_USD !== undefined) {
    const perImageMicroUsd = Number(ctx.env.ITSTUDIO_E2E_IMAGE_PRICE_MICRO_USD);
    if (!Number.isSafeInteger(perImageMicroUsd) || perImageMicroUsd < 0)
      throw new Error('ITSTUDIO_E2E_IMAGE_PRICE_MICRO_USD must be a non-negative safe integer.');
    const imagePrice: PriceEntry = {
      modelKey: modelKeySchema.parse('openai/image-generation'),
      inputPerMTokMicroUsd: microUsd(0),
      outputPerMTokMicroUsd: microUsd(0),
      cachedInputPerMTokMicroUsd: microUsd(0),
      perImageMicroUsd: microUsd(perImageMicroUsd),
      freeTier: false,
      sourceUrl: 'https://example.invalid/e2e-image-price',
    };
    pricing.applyExtracted([imagePrice]);
  }
  const prices = new RepositoryPriceSource(priceRepository, fx);
  const ledger = new LedgerService({
    repository: ledgerRepository,
    prices,
    completed: deps.catalog.completed,
    events,
    ids,
    clock,
    logger,
  });
  const pnl = new PnLService({ ledger: ledgerRepository, revenue: revenueRepository, projects, fx: prices });
  const revenue = new RevenueService({ repository: revenueRepository, projects, fx, ids, clock });
  const budget = new BudgetGuard({ repository: new BudgetRepository(ctx.db), settings, prices, events, clock });
  let fxJobStopped = false;
  return {
    fx,
    pricing,
    prices,
    ledger,
    ledgerRepository,
    pnl,
    revenue,
    budget,
    moneyDisplay: (amount: MicroUsd) => toMoneyDisplay(amount, fx.getEffective()),
    /** USD and VND cost lines for process cards. */
    costText: (amount: MicroUsd) => {
      const cost = toMoneyDisplay(amount, fx.getEffective());
      return cost.usdText + '\n' + cost.vndText;
    },
    clearPriceOverride: (modelKey: ModelKey) => {
      const result = pricing.clearOverride(modelKey);
      if (result.ok) {
        const now = isoDateTimeSchema.parse(clock.now().toISOString());
        events.publish('pricing.updated', {
          startedAt: now,
          finishedAt: now,
          status: 'applied',
          deltas: [],
          newVersion: result.value.version,
        });
      }
      return result;
    },
    /** Loads the FX rate, then starts the daily refresh unless shutdown already began. */
    start: () => {
      void fx.initialize().then(
        () => {
          if (!fxJobStopped) fxDailyJob.start();
        },
        (error: unknown) => {
          if (!fxJobStopped) {
            logger.warn(
              { svc: 'fx', error: error instanceof Error ? error.message : 'unknown' },
              'FX initialization failed',
            );
          }
          if (!fxJobStopped) fxDailyJob.start();
        },
      );
    },
    beginShutdown: () => {
      fxJobStopped = true;
    },
    stop: () => {
      fxJobStopped = true;
      fxDailyJob.stop();
    },
  };
}

export type CostModule = ReturnType<typeof createCostModule>;

export interface PricingUpdaterDependencies {
  readonly cost: CostModule;
  readonly catalog: ModelCatalog;
  readonly processes: IProcessTracker;
  readonly settings: SettingsService;
  readonly secretStore: ISecretStore;
  readonly router: LlmRouter;
  readonly http?: IHttpClient | undefined;
}

/** Price-page refresh through an LLM extraction; it needs the router, so it is built after it. */
export function createPricingUpdater(ctx: ModuleContext, deps: PricingUpdaterDependencies): PricingUpdater {
  return new PricingUpdater({
    processes: deps.processes,
    costText: deps.cost.costText,
    settings: deps.settings,
    secretStore: deps.secretStore,
    projects: new ProjectRepository(ctx.db),
    pricing: deps.cost.pricing,
    router: deps.router,
    http: deps.http ?? new FetchHttpClient(),
    sources: ctx.seeds.pricingSources,
    models: deps.catalog.models.list(),
    events: ctx.events,
    ids: ctx.ids,
    clock: ctx.clock,
    logger: ctx.logger,
  });
}

export type { IPriceSource } from './services/price-source.js';
export type { LedgerService } from './services/ledger-service.js';
export type { PricingUpdater } from './services/pricing-updater.js';
export { registerCostRpc } from './rpc.js';
