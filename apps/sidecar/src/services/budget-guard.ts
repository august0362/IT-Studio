import {
  ErrorCode,
  type AppError,
  type Budget,
  type BudgetStatus,
  type ProjectId,
  type Result,
  type RpcNotificationMap,
} from '@itstudio/schemas';
import type { IClock } from '../infra/clock.js';
import type { IBudgetRepository } from '../ports/budget-repository.js';
import type { BudgetCheck, IBudgetGuard } from '../ports/budget-guard.js';
import type { EventBus } from '../rpc/event-bus.js';
import type { SettingsService } from './settings-service.js';
import type { IPriceSource } from './price-source.js';
import { budgetLevel, crossedThresholds, fractionUsed, periodWindow } from '../domain/budget.js';
import { microUsd } from '../domain/cost.js';
import { toMoneyDisplay } from '../domain/money.js';
import { budgetSchema } from '../validation/cost.js';
import { microUsdSchema } from '../validation/brand.js';

export interface BudgetGuardDependencies {
  readonly repository: IBudgetRepository;
  readonly settings: SettingsService;
  readonly prices: IPriceSource;
  readonly events: EventBus<RpcNotificationMap>;
  readonly clock: IClock;
}

export class BudgetGuard implements IBudgetGuard {
  private readonly deps: BudgetGuardDependencies;

  constructor(dependencies: BudgetGuardDependencies) {
    this.deps = dependencies;
  }

  async set(budget: Budget): Promise<Result<BudgetStatus>> {
    const validated = validateBudget(budget);
    if (!validated.ok) return validated;
    await this.deps.repository.upsert(validated.value);
    const status = await this.statusFor(validated.value, await this.hardStopEnabled());
    return { ok: true, value: status };
  }

  async status(projectId: ProjectId): Promise<Result<readonly BudgetStatus[]>> {
    const budgets = await this.deps.repository.list(projectId);
    const hardStop = await this.hardStopEnabled();
    return { ok: true, value: await Promise.all(budgets.map((budget) => this.statusFor(budget, hardStop))) };
  }

  async check(projectId: ProjectId, estimate: number): Promise<Result<BudgetCheck>> {
    const parsedEstimate = microUsdSchema.safeParse(estimate);
    if (!parsedEstimate.success) return validationFailure('Budget estimate must be a non-negative integer amount.');
    const budgets = await this.deps.repository.list(projectId);
    const hardStop = await this.hardStopEnabled();
    let level: BudgetCheck['level'] = 'ok';
    let blocking = false;
    for (const budget of budgets) {
      const window = periodWindow(budget.period, this.deps.clock.now());
      const spent = await this.deps.repository.spent(projectId, window.from, window.to);
      const before = fractionUsed(spent, budget.limitMicroUsd);
      const projected = microUsd(spent + parsedEstimate.data);
      const after = fractionUsed(projected, budget.limitMicroUsd);
      const currentLevel = budgetLevel(after, budget.warnAt);
      if (rank(currentLevel) > rank(level)) level = currentLevel;
      if (currentLevel === 'exceeded' && hardStop) blocking = true;
      for (const threshold of crossedThresholds(before, after, budget.warnAt)) {
        const alerted = await this.deps.repository.recordAlert(
          {
            projectId,
            period: budget.period,
            windowKey: window.key,
            threshold,
          },
          this.deps.clock.now(),
        );
        if (alerted) this.deps.events.publish('budget.alert', this.makeStatus(budget, projected, hardStop));
      }
    }
    return { ok: true, value: { level, blocking } };
  }

  private async statusFor(budget: Budget, hardStop: boolean): Promise<BudgetStatus> {
    const window = periodWindow(budget.period, this.deps.clock.now());
    const spent = await this.deps.repository.spent(budget.projectId, window.from, window.to);
    return this.makeStatus(budget, spent, hardStop);
  }

  private makeStatus(budget: Budget, spent: number, hardStop: boolean): BudgetStatus {
    const limit = budget.limitMicroUsd;
    const remaining = microUsd(Math.max(0, limit - spent));
    const level = budgetLevel(fractionUsed(spent, limit), budget.warnAt);
    return {
      budget,
      spent: toMoneyDisplay(microUsd(spent), this.deps.prices.getFxRate()),
      remaining: toMoneyDisplay(remaining, this.deps.prices.getFxRate()),
      fractionUsed: fractionUsed(spent, limit),
      level,
      blocking: hardStop && level === 'exceeded',
    };
  }

  private async hardStopEnabled(): Promise<boolean> {
    const settings = await this.deps.settings.get();
    return settings.ok && settings.value.budget.hardStop;
  }
}

function validateBudget(budget: Budget): Result<Budget> {
  const parsed = budgetSchema.safeParse(budget);
  if (!parsed.success) return validationFailure('Budget is invalid.');
  if (!Number.isSafeInteger(parsed.data.limitMicroUsd) || parsed.data.limitMicroUsd <= 0)
    return validationFailure('Budget limit must be a positive integer amount.');
  let previous = 0;
  for (const threshold of parsed.data.warnAt) {
    if (!Number.isFinite(threshold) || threshold <= previous || threshold > 1)
      return validationFailure('Warning thresholds must be ascending fractions in (0, 1].');
    previous = threshold;
  }
  return { ok: true, value: parsed.data };
}

function rank(level: BudgetCheck['level']): number {
  return level === 'ok' ? 0 : level === 'warning' ? 1 : 2;
}

function validationFailure(message: string): Result<never> {
  const error: AppError = {
    code: ErrorCode.VALIDATION,
    message,
    retryable: false,
    remediation: ['Review the budget limit and warning thresholds.'],
  };
  return { ok: false, error };
}
