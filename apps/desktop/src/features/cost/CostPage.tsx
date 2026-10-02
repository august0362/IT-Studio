import type { IsoDateTime, ProjectId } from '@itstudio/schemas';
import { useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../../hooks/use-notification';
import { useRpcQuery } from '../../hooks/use-rpc-query';
import { getDateRange, type DatePreset, type DateRange } from './date-range';
import { KpiCards } from './KpiCards';
import { BreakdownCharts } from './BreakdownCharts';
import { BudgetBars } from './BudgetBars';
import { RevenueForm } from './RevenueForm';
import { LedgerTable } from './LedgerTable';
import { PortfolioPage } from './PortfolioPage';

const EMPTY_LEDGER_PAGE = { items: [], nextCursor: null } as const;

export function CostPage({ projectId }: { readonly projectId: ProjectId | null }): JSX.Element {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [preset, setPreset] = useState<DatePreset>('thisMonth');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const range = useMemo<DateRange>(
    () =>
      preset === 'custom' && customFrom !== '' && customTo !== ''
        ? {
            from: new Date(`${customFrom}T00:00:00.000Z`).toISOString() as IsoDateTime,
            to: new Date(new Date(`${customTo}T00:00:00.000Z`).getTime() + 86_400_000).toISOString() as IsoDateTime,
          }
        : getDateRange(preset),
    [preset, customFrom, customTo],
  );
  const portfolio = useRpcQuery('pnl.getAll', range, { enabled: projectId === null });
  const projects = useRpcQuery('project.list', {}, { enabled: projectId === null });
  const refreshPortfolio = useCallback((): void => {
    if (projectId === null) void client.invalidateQueries({ queryKey: ['pnl.getAll', range] });
  }, [client, projectId, range]);
  useNotification('ledger.entry', refreshPortfolio);
  useNotification('budget.alert', refreshPortfolio);
  const rangeControls = (
    <div className="flex flex-wrap items-end gap-2">
      <label>
        {t('cost.dateRange')}
        <select
          className="ml-2 rounded border border-border bg-surface p-2"
          value={preset}
          onChange={(event) => {
            setPreset(event.target.value as DatePreset);
          }}
        >
          {(['today', 'last7Days', 'thisMonth', 'lastMonth', 'allTime', 'custom'] as const).map((value) => (
            <option key={value} value={value}>
              {t(`cost.ranges.${value}`)}
            </option>
          ))}
        </select>
      </label>
      {preset === 'custom' ? (
        <>
          <label>
            {t('cost.from')}
            <input
              className="ml-2 rounded border border-border bg-surface p-2"
              type="date"
              value={customFrom}
              onChange={(event) => {
                setCustomFrom(event.target.value);
              }}
            />
          </label>
          <label>
            {t('cost.to')}
            <input
              className="ml-2 rounded border border-border bg-surface p-2"
              type="date"
              value={customTo}
              onChange={(event) => {
                setCustomTo(event.target.value);
              }}
            />
          </label>
        </>
      ) : null}
    </div>
  );
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('cost.heading')}</h1>
      {rangeControls}
      {projectId !== null ? (
        <ProjectCostView key={`${projectId}:${range.from}:${range.to}`} projectId={projectId} range={range} />
      ) : portfolio.isLoading ? (
        <p>{t('cost.loading')}</p>
      ) : portfolio.error ? (
        <p role="alert" className="text-danger">
          {portfolio.error.message}
        </p>
      ) : portfolio.data && projects.data ? (
        <PortfolioPage data={portfolio.data} projects={projects.data} />
      ) : null}
    </div>
  );
}

function ProjectCostView({
  projectId,
  range,
}: {
  readonly projectId: ProjectId;
  readonly range: DateRange;
}): JSX.Element {
  const { t } = useTranslation();
  const client = useQueryClient();
  const refreshTimer = useRef<number | null>(null);
  const projectPnl = useRpcQuery('pnl.get', { projectId, ...range });
  const budgets = useRpcQuery('budget.status', { projectId });
  const revenue = useRpcQuery('revenue.listRows', { projectId, ...range });
  const ledger = useRpcQuery('ledger.queryRows', { projectId, ...range, limit: 50 });
  useEffect(
    () => () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    },
    [],
  );
  const refreshSoon = useCallback((): void => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      void client.invalidateQueries({ queryKey: ['pnl.get', { projectId, ...range }] });
      void client.invalidateQueries({ queryKey: ['budget.status', { projectId }] });
      void client.invalidateQueries({ queryKey: ['ledger.queryRows', { projectId, ...range, limit: 50 }] });
    }, 1000);
  }, [client, projectId, range]);
  useNotification('ledger.entry', refreshSoon);
  useNotification('budget.alert', refreshSoon);
  if (projectPnl.isLoading) return <p>{t('cost.loading')}</p>;
  if (projectPnl.error)
    return (
      <p role="alert" className="text-danger">
        {projectPnl.error.message}
      </p>
    );
  if (projectPnl.data === undefined) return <></>;
  return (
    <div className="space-y-4">
      <KpiCards data={projectPnl.data} />
      <BreakdownCharts
        byModel={projectPnl.data.byModel}
        byPurpose={projectPnl.data.byPurpose}
        byDay={projectPnl.data.byDay}
      />
      {projectPnl.data.revenue.microUsd === 0 && projectPnl.data.cost.microUsd === 0 ? (
        <p className="text-text-muted">{t('cost.empty')}</p>
      ) : null}
      <BudgetBars
        projectId={projectId}
        statuses={budgets.data ?? []}
        onSaved={() => {
          void client.invalidateQueries({ queryKey: ['budget.status', { projectId }] });
        }}
      />
      <RevenueForm
        projectId={projectId}
        rows={revenue.data ?? []}
        onAdded={() => {
          void client.invalidateQueries({ queryKey: ['pnl.get', { projectId, ...range }] });
          void client.invalidateQueries({ queryKey: ['revenue.listRows', { projectId, ...range }] });
        }}
      />
      <LedgerTable
        key={`${projectId}:${range.from}:${range.to}:${ledger.data?.items[0]?.entry.id ?? ''}`}
        from={range.from}
        initial={ledger.data ?? EMPTY_LEDGER_PAGE}
        projectId={projectId}
        to={range.to}
      />
    </div>
  );
}
