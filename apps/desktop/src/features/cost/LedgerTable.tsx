import type { CostPurpose, IsoDateTime, LedgerRow, ModelKey, Page, ProjectId } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRpcQuery } from '../../hooks/use-rpc-query';
import { useRpcClient } from '../../rpc/rpc-context';
import { Money } from '../../components/Money';
import { formatDateTime } from '../../i18n/format';

export function LedgerTable({
  projectId,
  from,
  to,
  initial,
}: {
  readonly projectId: ProjectId;
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
  readonly initial: Page<LedgerRow>;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const rpc = useRpcClient();
  const [page, setPage] = useState(initial);
  const [model, setModel] = useState('');
  const [purpose, setPurpose] = useState('');
  const models = useRpcQuery('models.list', {});
  const [loading, setLoading] = useState(false);
  async function load(cursor?: string): Promise<void> {
    setLoading(true);
    try {
      const next = await rpc.call('ledger.queryRows', {
        projectId,
        from,
        to,
        limit: 50,
        ...(cursor === undefined ? {} : { cursor }),
        ...(models.data?.some((item) => item.key === model) ? { modelKeys: [model as ModelKey] } : {}),
        ...(purpose === '' ? {} : { purposes: [purpose as CostPurpose] }),
      });
      setPage(cursor === undefined ? next : { items: [...page.items, ...next.items], nextCursor: next.nextCursor });
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="space-y-3 rounded border border-border bg-surface p-4">
      <h2 className="font-semibold">{t('cost.ledger')}</h2>
      <div className="flex gap-3">
        <label>
          {t('cost.filterModel')}
          <select
            className="ml-2 rounded border border-border bg-bg p-1"
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
            }}
          >
            <option value="">{t('cost.all')}</option>
            {(models.data ?? []).map((item) => (
              <option key={item.key} value={item.key}>
                {item.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('cost.filterPurpose')}
          <select
            className="ml-2 rounded border border-border bg-bg p-1"
            value={purpose}
            onChange={(event) => {
              setPurpose(event.target.value);
            }}
          >
            <option value="">{t('cost.all')}</option>
            {[
              'chat',
              'pipeline_pm',
              'pipeline_coder',
              'pipeline_reviewer',
              'embedding',
              'image',
              'pricing_extraction',
            ].map((value) => (
              <option key={value} value={value}>
                {t(`cost.purpose.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded border border-border px-2" onClick={() => void load()} type="button">
          {t('cost.applyFilters')}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {['time', 'model', 'purpose', 'input', 'output', 'cost', 'billed'].map((key) => (
                <th className="p-2" key={key}>
                  {t(`cost.ledgerColumns.${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.items.map(({ entry, cost }) => (
              <tr className="border-t border-border" key={entry.id}>
                <td className="p-2">{formatDateTime(entry.occurredAt, i18n.language)}</td>
                <td className="p-2">{entry.modelKey}</td>
                <td className="p-2">{t(`cost.purpose.${entry.purpose}`)}</td>
                <td className="p-2">{entry.usage.inputTokens}</td>
                <td className="p-2">{entry.usage.outputTokens}</td>
                <td className="p-2">
                  <Money compact value={cost} />
                </td>
                <td className="p-2">{t(entry.billedFailure ? 'cost.yes' : 'cost.no')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {page.nextCursor ? (
        <button
          className="rounded border border-border px-3 py-2"
          disabled={loading}
          onClick={() => void load(page.nextCursor ?? undefined)}
          type="button"
        >
          {t('cost.loadMore')}
        </button>
      ) : null}
    </section>
  );
}
