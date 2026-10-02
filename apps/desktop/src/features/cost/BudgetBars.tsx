import type { BudgetPeriod, BudgetStatus, ProjectId } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRpcClient } from '../../rpc/rpc-context';
import { Money } from '../../components/Money';

export function BudgetBars({
  projectId,
  statuses,
  onSaved,
}: {
  readonly projectId: ProjectId;
  readonly statuses: readonly BudgetStatus[];
  readonly onSaved: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const [period, setPeriod] = useState<BudgetPeriod>('monthly');
  const [limitUsd, setLimitUsd] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function save(): Promise<void> {
    setError('');
    setPending(true);
    try {
      await rpc.call('budget.setUsd', { projectId, period, limitUsd, warnAt: [0.5, 0.8, 1] });
      onSaved();
      setLimitUsd('');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('cost.budgetError'));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="space-y-3 rounded border border-border bg-surface p-4">
      <h2 className="font-semibold">{t('cost.budgets')}</h2>
      {statuses.map((status) => (
        <div className="space-y-2" key={status.budget.period}>
          <div className="flex justify-between gap-3">
            <strong>{t(`cost.period.${status.budget.period}`)}</strong>
            <span
              style={{
                color: `var(--color-${status.level === 'ok' ? 'success' : status.level === 'warning' ? 'warning' : 'danger'})`,
              }}
            >
              {t(`cost.level.${status.level}`)}
            </span>
          </div>
          <div
            aria-label={`${Math.round(status.fractionUsed * 100).toString()}% ${t('cost.budgetUsage')}`}
            className="h-3 overflow-hidden rounded bg-surface-alt"
          >
            <div
              aria-hidden="true"
              className="h-full"
              style={{
                backgroundColor: `var(--color-${status.level === 'ok' ? 'success' : status.level === 'warning' ? 'warning' : 'danger'})`,
                width: `${Math.max(0, Math.min(status.fractionUsed * 100, 100)).toString()}%`,
              }}
            />
          </div>
          <p>
            {t('cost.budgetUsage')}: {Math.round(status.fractionUsed * 100)}% · <Money value={status.spent} compact />
          </p>
          {status.blocking ? (
            <p className="text-danger" role="status">
              {t('cost.hardStop')}
            </p>
          ) : null}
        </div>
      ))}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          {t('cost.periodLabel')}
          <select
            className="ml-2 rounded border border-border bg-bg p-2"
            value={period}
            onChange={(event) => {
              setPeriod(event.target.value as BudgetPeriod);
            }}
          >
            <option value="daily">{t('cost.period.daily')}</option>
            <option value="monthly">{t('cost.period.monthly')}</option>
            <option value="project_lifetime">{t('cost.period.project_lifetime')}</option>
          </select>
        </label>
        <label>
          {t('cost.budgetLimitUsd')}
          <input
            aria-label={t('cost.budgetLimitUsd')}
            className="ml-2 rounded border border-border bg-bg p-2"
            inputMode="decimal"
            value={limitUsd}
            onChange={(event) => {
              setLimitUsd(event.target.value);
            }}
          />
        </label>
        <button className="rounded bg-primary px-3 py-2 text-primary-fg" disabled={pending} type="submit">
          {t('cost.saveBudget')}
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
