import type { ProjectId, RevenueRow } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRpcClient } from '../../rpc/rpc-context';
import { Money } from '../../components/Money';
import { formatDate } from '../../i18n/format';

export function RevenueForm({
  projectId,
  rows,
  onAdded,
}: {
  readonly projectId: ProjectId;
  readonly rows: readonly RevenueRow[];
  readonly onAdded: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const rpc = useRpcClient();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'VND'>('USD');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  async function submit(): Promise<void> {
    setError('');
    if (!/^\d+(?:\.\d+)?$/u.test(amount) || Number(amount) <= 0 || description.trim() === '') {
      setError(t('cost.invalidRevenue'));
      return;
    }
    try {
      await rpc.call('revenue.add', { projectId, amount: Number(amount), currency, description });
      onAdded();
      setAmount('');
      setDescription('');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('cost.revenueError'));
    }
  }
  return (
    <section className="space-y-3 rounded border border-border bg-surface p-4">
      <h2 className="font-semibold">{t('cost.revenueEntries')}</h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          {t('cost.amount')}
          <input
            className="ml-2 rounded border border-border bg-bg p-2"
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        </label>
        <label>
          {t('cost.currency')}
          <select
            className="ml-2 rounded border border-border bg-bg p-2"
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value as 'USD' | 'VND');
            }}
          >
            <option>USD</option>
            <option>VND</option>
          </select>
        </label>
        <label>
          {t('cost.description')}
          <input
            className="ml-2 rounded border border-border bg-bg p-2"
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        </label>
        <button className="rounded bg-primary px-3 py-2 text-primary-fg" type="submit">
          {t('cost.addRevenue')}
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li className="flex justify-between py-2" key={row.entry.id}>
            <span>
              {row.entry.description} · {formatDate(row.entry.occurredAt, i18n.language)}
            </span>
            <Money value={row.amount} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}
