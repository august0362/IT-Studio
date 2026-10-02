import type { CostBreakdownRow } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export function BreakdownCharts({
  byModel,
  byPurpose,
  byDay,
}: {
  readonly byModel: readonly CostBreakdownRow[];
  readonly byPurpose: readonly CostBreakdownRow[];
  readonly byDay: readonly CostBreakdownRow[];
}): JSX.Element {
  const { t } = useTranslation();
  const chartColor = (index: number) => `var(--color-chart-${((index % 6) + 1).toString()})`;
  const chart = (title: string, rows: readonly CostBreakdownRow[], type: 'bar' | 'pie' | 'line') => (
    <section className="rounded border border-border bg-surface p-4" key={title} aria-label={title}>
      <h2 className="mb-3 font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-text-muted">{t('cost.noChartData')}</p>
      ) : (
        <>
          <p className="sr-only">{rows.map((row) => `${row.key}: ${row.cost.usdText}`).join('; ')}</p>
          <div aria-hidden="true" className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              {type === 'bar' ? (
                <BarChart data={rows}>
                  <CartesianGrid stroke="var(--color-border)" />
                  <XAxis dataKey="key" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="cost.microUsd" fill={chartColor(0)} />
                </BarChart>
              ) : type === 'pie' ? (
                <PieChart>
                  <Pie data={rows} dataKey="cost.microUsd" fill={chartColor(1)} nameKey="key" outerRadius={75} />
                  <Tooltip />
                </PieChart>
              ) : (
                <LineChart data={rows}>
                  <CartesianGrid stroke="var(--color-border)" />
                  <XAxis dataKey="key" />
                  <YAxis />
                  <Tooltip />
                  <Line dataKey="cost.microUsd" stroke={chartColor(0)} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 flex flex-wrap gap-3 text-sm">
            {rows.map((row, index) => (
              <li key={row.key}>
                <span aria-hidden="true" style={{ color: chartColor(index) }}>
                  ●
                </span>{' '}
                {row.key}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {chart(t('cost.byModel'), byModel, 'bar')}
      {chart(t('cost.byPurpose'), byPurpose, 'pie')}
      {chart(t('cost.byDay'), byDay, 'line')}
    </div>
  );
}
