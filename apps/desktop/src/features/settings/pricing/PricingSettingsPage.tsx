import type { AppError, ModelKey, PriceRow, PriceTable, PriceUpdateRun } from '@itstudio/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../../i18n/format';
import { ErrorPanel } from '../../../components/ErrorPanel';
import { Money } from '../../../components/Money';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useNotification } from '../../../hooks/use-notification';
import { useRpcQuery } from '../../../hooks/use-rpc-query';
import { RpcCallError } from '../../../rpc/rpc-client';
import { useRpcClient } from '../../../rpc/rpc-context';
import { SettingsHeading } from '../settings-form';
import { PricingExtractionControl } from './PricingExtractionControl';
import { PricingUpdateResult, PricingUpdateToast } from './PricingUpdateResult';

interface OverrideDraft {
  readonly modelKey: ModelKey;
  readonly input: string;
  readonly output: string;
  readonly cached: string;
}
const USD_DECIMAL = /^\d+(\.\d{1,6})?$/;
const TOAST_DURATION_MS = 8000;

function rowOrigin(row: PriceRow, table: PriceTable): PriceTable['origin'] {
  return row.origin ?? (row.overridden ? 'manual_override' : (row.entry.origin ?? table.origin));
}

export function PricingSettingsPage({ projectActive }: { readonly projectActive: boolean }) {
  const { t, i18n } = useTranslation();
  const rpc = useRpcClient();
  const cache = useQueryClient();
  const prices = useRpcQuery('pricing.getRows', {});
  const models = useRpcQuery('models.list', {});
  const [running, setRunning] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [failure, setFailure] = useState<AppError | null>(null);
  const [result, setResult] = useState<PriceUpdateRun | null>(null);
  const [toast, setToast] = useState<PriceUpdateRun | null>(null);
  const [draft, setDraft] = useState<OverrideDraft | null>(null);
  const [overrideError, setOverrideError] = useState<AppError | null>(null);
  const [saved, setSaved] = useState(false);
  const [clearTarget, setClearTarget] = useState<{ readonly modelKey: ModelKey; readonly modelName: string } | null>(
    null,
  );
  const [clearError, setClearError] = useState<AppError | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, TOAST_DURATION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);
  useNotification('pricing.updated', () => {
    void cache.invalidateQueries({ queryKey: ['pricing.getRows', {}] });
  });
  async function refresh(): Promise<void> {
    setRunning(true);
    setFailure(null);
    setResult(null);
    setToast(null);
    try {
      const run = await rpc.call('pricing.refresh', {});
      setResult(run);
      setToast(run);
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
  async function selectExtractionModel(modelKey: ModelKey): Promise<void> {
    setSavingModel(true);
    setFailure(null);
    try {
      await rpc.call('settings.update', { patch: { pricing: { extractionModelKey: modelKey } } });
      await cache.invalidateQueries({ queryKey: ['pricing.getRows', {}] });
    } catch (error: unknown) {
      setFailure(
        error instanceof RpcCallError
          ? error.appError
          : { code: 'INTERNAL', message: t('settings.saveError'), retryable: true, remediation: [t('settings.retry')] },
      );
    } finally {
      setSavingModel(false);
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
  async function clearOverride(): Promise<void> {
    if (clearTarget === null) return;
    setRunning(true);
    setClearError(null);
    try {
      await rpc.call('pricing.clearOverride', { modelKey: clearTarget.modelKey });
      setClearTarget(null);
      await cache.invalidateQueries({ queryKey: ['pricing.getRows', {}] });
    } catch (error: unknown) {
      setClearError(
        error instanceof RpcCallError
          ? error.appError
          : {
              code: 'INTERNAL',
              message: t('settings.pricing.clearError'),
              retryable: true,
              remediation: [t('settings.retry')],
            },
      );
    } finally {
      setRunning(false);
    }
  }
  const name = (key: string) => models.data?.find((model) => model.key === key)?.displayName ?? key;
  const priceData = prices.data;
  const origins = priceData ? [...new Set(priceData.rows.map((row) => rowOrigin(row, priceData.table)))] : [];
  const seedRemaining = origins.includes('seed');
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
      {prices.error ? <ErrorPanel error={prices.error.appError} onRetry={() => void prices.refetch()} /> : null}
      {prices.data ? (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <dt className="text-text-muted">{t('settings.pricing.lastUpdated')}</dt>
            <dd>
              <time dateTime={prices.data.table.effectiveFrom}>
                {formatDateTime(prices.data.table.effectiveFrom, i18n.language)}
              </time>
            </dd>
          </div>
          <div>
            <dt className="text-text-muted">{t('settings.pricing.origin')}</dt>
            <dd>
              {(origins.length > 0 ? origins : [prices.data.table.origin])
                .map((origin) => t(`settings.pricing.origins.${origin}`))
                .join(' · ')}
            </dd>
          </div>
        </dl>
      ) : null}
      {seedRemaining ? (
        <p className="rounded border border-warning p-3" role="status">
          {t('settings.pricing.seedWarning')}
        </p>
      ) : null}
      {failure ? <ErrorPanel error={failure} /> : null}
      {result ? <PricingUpdateResult modelName={name} result={result} /> : null}
      <PricingExtractionControl
        disabled={running || savingModel}
        extraction={prices.data?.extraction}
        onSelect={(modelKey) => void selectExtractionModel(modelKey)}
      />
      <button
        id="pricing-update"
        className="rounded bg-primary px-4 py-2 text-primary-fg disabled:opacity-50"
        disabled={
          running ||
          savingModel ||
          !projectActive ||
          prices.isPending ||
          prices.isError ||
          !prices.data.extraction?.selectedModelKey
        }
        onClick={() => {
          void refresh();
        }}
        type="button"
      >
        {running ? t('settings.pricing.updating') : t('settings.pricing.update')}
      </button>
      <div id="pricing-overrides" tabIndex={-1} className="overflow-x-auto rounded border border-border">
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
                    {prices.data ? t(`settings.pricing.origins.${rowOrigin(row, prices.data.table)}`) : ''}
                  </a>
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-2">
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
                    {row.overridden ? (
                      <button
                        className="rounded border border-border px-2 py-1"
                        disabled={running}
                        onClick={() => {
                          setClearError(null);
                          setClearTarget({ modelKey: row.entry.modelKey, modelName: name(row.entry.modelKey) });
                        }}
                        type="button"
                      >
                        {t('settings.pricing.clearOverride')}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {saved ? <p role="status">{t('settings.saved')}</p> : null}
      {toast ? <PricingUpdateToast result={toast} /> : null}
      {clearError ? <ErrorPanel error={clearError} /> : null}
      <ConfirmDialog
        cancelLabel={t('settings.cancel')}
        confirmLabel={t('settings.pricing.clearOverride')}
        message={
          clearTarget === null ? '' : t('settings.pricing.clearOverrideMessage', { model: clearTarget.modelName })
        }
        onCancel={() => {
          setClearTarget(null);
        }}
        onConfirm={() => void clearOverride()}
        open={clearTarget !== null}
        title={t('settings.pricing.clearOverrideTitle')}
        tone="danger"
      />
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
