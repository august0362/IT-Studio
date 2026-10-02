import type { AppError, ModelKey, PriceUpdateRun } from '@itstudio/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorPanel } from '../../../components/ErrorPanel';
import { Money } from '../../../components/Money';
import { useNotification } from '../../../hooks/use-notification';
import { useRpcQuery } from '../../../hooks/use-rpc-query';
import { RpcCallError } from '../../../rpc/rpc-client';
import { useRpcClient } from '../../../rpc/rpc-context';
import { SettingsHeading } from '../settings-form';

interface OverrideDraft {
  readonly modelKey: ModelKey;
  readonly input: string;
  readonly output: string;
  readonly cached: string;
}
const USD_DECIMAL = /^\d+(\.\d{1,6})?$/;

export function PricingSettingsPage({ projectActive }: { readonly projectActive: boolean }) {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const cache = useQueryClient();
  const prices = useRpcQuery('pricing.getRows', {});
  const models = useRpcQuery('models.list', {});
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<AppError | null>(null);
  const [result, setResult] = useState<PriceUpdateRun | null>(null);
  const [draft, setDraft] = useState<OverrideDraft | null>(null);
  const [overrideError, setOverrideError] = useState<AppError | null>(null);
  const [saved, setSaved] = useState(false);
  useNotification('pricing.updated', () => {
    void cache.invalidateQueries({ queryKey: ['pricing.getRows', {}] });
  });
  async function refresh(): Promise<void> {
    setRunning(true);
    setFailure(null);
    setResult(null);
    try {
      setResult(await rpc.call('pricing.refresh', {}));
      await cache.invalidateQueries({ queryKey: ['pricing.getRows', {}] });
    } catch (error: unknown) {
      setFailure(
        error instanceof RpcCallError
          ? error.appError
          : {
              code: 'INTERNAL',
              message: t('settings.pricing.fetchError'),
              retryable: true,
              remediation: [t('settings.retry')],
            },
      );
    } finally {
      setRunning(false);
    }
  }
  async function saveOverride(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (
      !draft ||
      !USD_DECIMAL.test(draft.input) ||
      !USD_DECIMAL.test(draft.output) ||
      !USD_DECIMAL.test(draft.cached)
    ) {
      setOverrideError({
        code: 'VALIDATION',
        message: t('settings.pricing.invalidOverride'),
        retryable: false,
        remediation: [t('settings.pricing.usdFormat')],
      });
      return;
    }
    setRunning(true);
    setOverrideError(null);
    setSaved(false);
    try {
      await rpc.call('pricing.overrideUsd', {
        modelKey: draft.modelKey,
        inputPerMTokUsd: draft.input,
        outputPerMTokUsd: draft.output,
        cachedInputPerMTokUsd: draft.cached,
      });
      setDraft(null);
      setSaved(true);
      await cache.invalidateQueries({ queryKey: ['pricing.getRows', {}] });
    } catch (error: unknown) {
      setOverrideError(
        error instanceof RpcCallError
          ? error.appError
          : { code: 'INTERNAL', message: t('settings.saveError'), retryable: true, remediation: [t('settings.retry')] },
      );
    } finally {
      setRunning(false);
    }
  }
  const name = (key: string) => models.data?.find((model) => model.key === key)?.displayName ?? key;
  return (
    <section aria-labelledby="settings-heading" className="space-y-5">
      <SettingsHeading section="pricing" />
      {!projectActive ? (
        <p className="rounded border border-warning p-3" role="status">
          {t('settings.pricing.noProject')}
        </p>
      ) : null}
      {prices.data?.stale ? (
        <p className="rounded border border-warning p-3" role="status">
          {t('settings.pricing.stale')}
        </p>
      ) : null}
      {failure ? <ErrorPanel error={failure} onRetry={() => void refresh()} /> : null}
      {result ? (
        <section aria-live="polite" className="space-y-2 rounded border border-border bg-surface p-4">
          <h3 className="font-semibold">{t(`settings.pricing.status.${result.status}`)}</h3>
          {result.status === 'fetch_failed' && result.error ? <ErrorPanel error={result.error} /> : null}
          {result.deltas.length > 0 ? (
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>{t('settings.pricing.model')}</th>
                  <th>{t('settings.pricing.change')}</th>
                </tr>
              </thead>
              <tbody>
                {result.deltas.map((delta, index) => (
                  <tr key={`${delta.modelKey}-${delta.field}-${String(index)}`}>
                    <td>
                      {name(delta.modelKey)} · {delta.field}
                    </td>
                    <td>
                      {new Intl.NumberFormat(undefined, { signDisplay: 'always', maximumFractionDigits: 2 }).format(
                        delta.percent,
                      )}
                      %
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}
      <button
        className="rounded bg-primary px-4 py-2 text-primary-fg disabled:opacity-50"
        disabled={running || !projectActive}
        onClick={() => {
          void refresh();
        }}
        type="button"
      >
        {running ? t('settings.pricing.updating') : t('settings.pricing.update')}
      </button>
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface">
            <tr>
              {['model', 'input', 'output', 'cached', 'origin', 'override'].map((key) => (
                <th className="p-2" key={key}>
                  {t(`settings.pricing.${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(prices.data?.rows ?? []).map((row) => (
              <tr className="border-t border-border" key={row.entry.modelKey}>
                <td className="p-2">
                  {name(row.entry.modelKey)}
                  {row.overridden ? (
                    <span className="ml-2 rounded bg-warning px-2 py-1 text-xs">
                      {t('settings.pricing.overridden')}
                    </span>
                  ) : null}
                </td>
                <td className="p-2">
                  <Money compact value={row.input} />
                </td>
                <td className="p-2">
                  <Money compact value={row.output} />
                </td>
                <td className="p-2">
                  <Money compact value={row.cachedInput} />
                </td>
                <td className="p-2">
                  <a className="underline" href={row.entry.sourceUrl} rel="noreferrer" target="_blank">
                    {prices.data?.table.origin}
                  </a>
                </td>
                <td className="p-2">
                  <button
                    className="rounded border border-border px-2 py-1"
                    onClick={() => {
                      setDraft({ modelKey: row.entry.modelKey, input: '', output: '', cached: '' });
                      setOverrideError(null);
                    }}
                    type="button"
                  >
                    {t('settings.pricing.override')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {saved ? <p role="status">{t('settings.saved')}</p> : null}
      {draft ? (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/50 p-4">
          <form
            aria-labelledby="override-heading"
            className="w-full max-w-lg space-y-4 rounded border border-border bg-surface p-5"
            onSubmit={(event) => {
              void saveOverride(event);
            }}
          >
            <h3 className="text-lg font-semibold" id="override-heading">
              {t('settings.pricing.overrideTitle', { model: name(draft.modelKey) })}
            </h3>
            <p className="text-sm text-text-muted">{t('settings.pricing.usdFormat')}</p>
            {(['input', 'output', 'cached'] as const).map((field) => (
              <label className="grid gap-1" key={field}>
                {t(`settings.pricing.${field}`)}
                <input
                  className="rounded border border-border bg-bg p-2"
                  disabled={running}
                  inputMode="decimal"
                  onChange={(event) => {
                    setDraft({ ...draft, [field]: event.target.value });
                  }}
                  required
                  type="text"
                  value={draft[field]}
                />
              </label>
            ))}
            {overrideError ? <ErrorPanel error={overrideError} /> : null}
            <div className="flex justify-end gap-2">
              <button
                className="rounded border border-border px-3 py-2"
                disabled={running}
                onClick={() => {
                  setDraft(null);
                }}
                type="button"
              >
                {t('settings.cancel')}
              </button>
              <button
                className="rounded bg-primary px-3 py-2 text-primary-fg disabled:opacity-50"
                disabled={running}
                type="submit"
              >
                {t('settings.save')}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
