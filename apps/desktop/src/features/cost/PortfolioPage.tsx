import type { PortfolioPnL, Project } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Money } from '../../components/Money';
import { KpiCards } from './KpiCards';

export function PortfolioPage({
  data,
  projects,
}: {
  readonly data: PortfolioPnL;
  readonly projects: readonly Project[];
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <KpiCards data={data} />
      <section className="rounded border border-border bg-surface p-4">
        <h2 className="mb-3 font-semibold">{t('cost.projectResults')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                {['project', 'revenue', 'cost', 'margin', 'marginPercent'].map((key) => (
                  <th className="p-2" key={key}>
                    {t(`cost.portfolioColumns.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.projects.map((row) => (
                <tr className="border-t border-border" key={row.projectId}>
                  <td className="p-2">
                    {projects.find((project) => project.id === row.projectId)?.name ?? row.projectId}
                  </td>
                  <td className="p-2">
                    <Money value={row.revenue} compact />
                  </td>
                  <td className="p-2">
                    <Money value={row.cost} compact />
                  </td>
                  <td className="p-2">
                    <Money value={row.margin} compact />
                  </td>
                  <td className="p-2">
                    {row.marginPercent === null ? '—' : `${(row.marginPercent * 100).toFixed(2)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="grid gap-3 md:grid-cols-2">
        {[
          { title: t('cost.topProjects'), rows: data.byProject },
          { title: t('cost.topModels'), rows: data.byModel },
        ].map(({ title, rows }) => (
          <section className="rounded border border-border bg-surface p-4" key={title}>
            <h2 className="mb-2 font-semibold">{title}</h2>
            <ul>
              {rows.map((row) => (
                <li className="flex justify-between py-1" key={row.key}>
                  <span>{row.key}</span>
                  <Money compact value={row.cost} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
