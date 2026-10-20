import type { BudgetPeriod } from '@itstudio/schemas';

export interface BudgetWindow {
  readonly key: string;
  readonly from?: Date;
  readonly to: Date;
}

export type BudgetLevel = 'ok' | 'warning' | 'exceeded';

export function periodWindow(period: BudgetPeriod, now: Date): BudgetWindow {
  const to = new Date(now);
  if (period === 'project_lifetime') return { key: 'lifetime', to };
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const from =
    period === 'daily' ? new Date(Date.UTC(year, month, now.getUTCDate())) : new Date(Date.UTC(year, month, 1));
  const next =
    period === 'daily' ? new Date(from.getTime() + 24 * 60 * 60 * 1000) : new Date(Date.UTC(year, month + 1, 1));
  return { key: from.toISOString(), from, to: next };
}

export function fractionUsed(spent: number, limit: number): number {
  return spent / limit;
}

export function budgetLevel(fraction: number, warnAt: readonly number[]): BudgetLevel {
  if (fraction >= 1) return 'exceeded';
  return warnAt.some((threshold) => threshold < 1 && fraction >= threshold) ? 'warning' : 'ok';
}

export function crossedThresholds(before: number, after: number, thresholds: readonly number[]): readonly number[] {
  return thresholds.filter((threshold) => before < threshold && after >= threshold);
}
