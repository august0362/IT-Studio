import type { AppError } from '@itstudio/schemas';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatNumber } from '../../../i18n/format';
import { ErrorPanel } from '../../../components/ErrorPanel';
import { useRpcQuery } from '../../../hooks/use-rpc-query';
import { RpcCallError } from '../../../rpc/rpc-client';
import { useRpcClient } from '../../../rpc/rpc-context';
import { SettingsHeading } from '../settings-form';

export function FxSettingsPage() {
  const { t, i18n } = useTranslation();
  const rpc = useRpcClient();
  const query = useRpcQuery('fx.get', {});
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<AppError | null>(null);
  async function update(rate: number | null): Promise<void> {
    setSaving(true);
    setFailure(null);
    setSaved(false);
    try {
      await rpc.call('fx.override', { usdToVnd: rate });
      await query.refetch();
      setValue('');
      setSaved(true);
    } catch (error: unknown) {
      setFailure(
        error instanceof RpcCallError
          ? error.appError
          : { code: 'INTERNAL', message: t('settings.saveError'), retryable: true, remediation: [t('settings.retry')] },
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section aria-labelledby="settings-heading" className="max-w-2xl space-y-5">
      <SettingsHeading section="fx" />
      {query.data ? (
        <div className="rounded border border-border bg-surface p-4">
          <p>
            {t('settings.fx.current', {
              rate: formatNumber(query.data.usdToVnd, i18n.language, { maximumFractionDigits: 4 }),
            })}
          </p>
          <p className="text-sm text-text-muted">
            {t(`settings.fx.source.${query.data.source}`)} · {formatDateTime(query.data.asOf, i18n.language)}
          </p>
        </div>
      ) : (
        <p role="status">{t('settings.loading')}</p>
      )}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const rate = Number(value);
          if (Number.isFinite(rate) && rate > 0) {
            void update(rate);
          }
        }}
      >
        <label className="grid gap-1">
          {t('settings.fx.override')}
          <input
            className="rounded border border-border bg-bg p-2"
            disabled={saving}
            inputMode="decimal"
            onChange={(event) => {
              setValue(event.target.value);
            }}
            required
            type="number"
            value={value}
          />
        </label>
        <button
          className="rounded bg-primary px-4 py-2 text-primary-fg disabled:opacity-50"
          disabled={saving || value === '' || Number(value) <= 0}
          type="submit"
        >
          {t('settings.save')}
        </button>
        <button
          className="rounded border border-border px-4 py-2 disabled:opacity-50"
          disabled={saving || query.data?.source !== 'manual_override'}
          onClick={() => {
            void update(null);
          }}
          type="button"
        >
          {t('settings.fx.clear')}
        </button>
      </form>
      {failure ? <ErrorPanel error={failure} /> : null}
      {saved ? <p role="status">{t('settings.saved')}</p> : null}
    </section>
  );
}
