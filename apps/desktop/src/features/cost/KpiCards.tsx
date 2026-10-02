import type { ProjectPnL, PortfolioPnL } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Money } from '../../components/Money';

export function KpiCards({ data }: { readonly data: ProjectPnL | PortfolioPnL }): JSX.Element {
  const { t } = useTranslation();
  const items = [
    [t('cost.revenue'), data.revenue],
    [t('cost.cost'), data.cost],
    [t('cost.margin'), data.margin],
  ] as const;
  return (
    <section aria-label={t('cost.kpis')} className="grid gap-3 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <article className="rounded border border-border bg-surface p-4" key={label}>
          <h2 className="mb-2 text-sm text-text-muted">{label}</h2>
          <Money value={value} />
        </article>
      ))}
      <article className="rounded border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm text-text-muted">{t('cost.marginPercent')}</h2>
        <p>{data.marginPercent === null ? '—' : `${(data.marginPercent * 100).toFixed(2)}%`}</p>
      </article>
    </section>
  );
}
