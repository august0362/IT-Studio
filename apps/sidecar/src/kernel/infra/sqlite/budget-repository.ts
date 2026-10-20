import { and, eq, gte, lt, sum } from 'drizzle-orm';
import type { Budget, MicroUsd, ProjectId } from '@itstudio/schemas';
import type { AppDatabase } from './database.js';
import { budgetAlerts, budgets, ledgerEntries } from './schema.js';
import type { BudgetAlertKey, IBudgetRepository } from '../../ports/budget-repository.js';
import { budgetSchema } from '../../validation/cost.js';
import { microUsdSchema } from '../../validation/brand.js';

export class BudgetRepository implements IBudgetRepository {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  list(projectId: ProjectId): Promise<readonly Budget[]> {
    const rows = this.db.select().from(budgets).where(eq(budgets.projectId, projectId)).all();
    return Promise.resolve(
      rows.map((row) =>
        budgetSchema.parse({
          projectId: row.projectId,
          period: row.period,
          limitMicroUsd: row.limitMicroUsd,
          warnAt: parseJson(row.warnAtJson),
        }),
      ),
    );
  }

  upsert(budget: Budget): Promise<void> {
    this.db
      .insert(budgets)
      .values({
        projectId: budget.projectId,
        period: budget.period,
        limitMicroUsd: budget.limitMicroUsd,
        warnAtJson: JSON.stringify(budget.warnAt),
      })
      .onConflictDoUpdate({
        target: [budgets.projectId, budgets.period],
        set: { limitMicroUsd: budget.limitMicroUsd, warnAtJson: JSON.stringify(budget.warnAt) },
      })
      .run();
    return Promise.resolve();
  }

  spent(projectId: ProjectId, from?: Date, to?: Date): Promise<MicroUsd> {
    const filters = [eq(ledgerEntries.projectId, projectId)];
    if (from !== undefined) filters.push(gte(ledgerEntries.occurredAt, from.toISOString()));
    if (to !== undefined) filters.push(lt(ledgerEntries.occurredAt, to.toISOString()));
    const row = this.db
      .select({ total: sum(ledgerEntries.costMicroUsd) })
      .from(ledgerEntries)
      .where(and(...filters))
      .get();
    return Promise.resolve(microUsdSchema.parse(Number(row?.total ?? 0)));
  }

  recordAlert(key: BudgetAlertKey, alertedAt: Date): Promise<boolean> {
    const result = this.db
      .insert(budgetAlerts)
      .values({
        ...key,
        alertedAt: alertedAt.toISOString(),
      })
      .onConflictDoNothing()
      .run();
    return Promise.resolve(result.changes > 0);
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (cause) {
    throw new Error('Stored budget thresholds JSON is invalid', { cause });
  }
}
