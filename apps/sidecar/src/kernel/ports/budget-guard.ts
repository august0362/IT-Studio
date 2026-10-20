import type { ProjectId, Result } from '@itstudio/schemas';

export interface BudgetCheck {
  readonly level: 'ok' | 'warning' | 'exceeded';
  readonly blocking: boolean;
}

export interface IBudgetGuard {
  check(projectId: ProjectId, estimate: number): Promise<Result<BudgetCheck>>;
}

export class AlwaysOkBudgetGuard implements IBudgetGuard {
  check(): Promise<Result<BudgetCheck>> {
    return Promise.resolve({ ok: true, value: { level: 'ok', blocking: false } });
  }
}
