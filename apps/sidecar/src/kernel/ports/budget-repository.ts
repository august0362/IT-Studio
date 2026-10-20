import type { Budget, BudgetPeriod, MicroUsd, ProjectId } from '@itstudio/schemas';

export interface BudgetAlertKey {
  readonly projectId: ProjectId;
  readonly period: BudgetPeriod;
  readonly windowKey: string;
  readonly threshold: number;
}

export interface IBudgetRepository {
  list(projectId: ProjectId): Promise<readonly Budget[]>;
  upsert(budget: Budget): Promise<void>;
  spent(projectId: ProjectId, from?: Date, to?: Date): Promise<MicroUsd>;
  recordAlert(key: BudgetAlertKey, alertedAt: Date): Promise<boolean>;
}
