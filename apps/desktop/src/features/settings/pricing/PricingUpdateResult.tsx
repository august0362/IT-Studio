import type { PriceUpdateRun } from '@itstudio/schemas';
import { useTranslation } from 'react-i18next';
import { ErrorPanel } from '../../../components/ErrorPanel';
import { formatNumber } from '../../../i18n/format';

interface PricingUpdateResultProps {
  readonly result: PriceUpdateRun;
  readonly modelName: (modelKey: string) => string;
}

export function PricingUpdateResult({ result, modelName }: PricingUpdateResultProps) {
  const { t, i18n } = useTranslation();
  const outcomes = result.providerOutcomes ?? [];
  return (
    <section
      aria-label={t('settings.pricing.resultTitle')}
      aria-live="polite"
      className="space-y-3 rounded border border-border bg-surface p-4"
    >
      <h3 className="font-semibold">
        {outcomes.length > 0 ? t('settings.pricing.resultTitle') : t(`settings.pricing.status.${result.status}`)}
      </h3>
      {outcomes.length > 0 ? (
        <ul className="space-y-2">
          {outcomes.map((outcome) => (
            <li className="rounded border border-border p-3" key={outcome.provider}>
              <p className="font-medium">
                {t(`settings.pricing.providers.${outcome.provider}`)} · {t(`settings.pricing.status.${outcome.status}`)}
              </p>
              <p className="mt-1 text-sm text-text-muted">{outcome.reason}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {result.error ? <ErrorPanel error={result.error} /> : null}
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
                  {modelName(delta.modelKey)} · {delta.field}
                </td>
                <td>
                  {formatNumber(delta.percent, i18n.language, { signDisplay: 'always', maximumFractionDigits: 2 })}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

export function PricingUpdateToast({ result }: { readonly result: PriceUpdateRun }) {
  const { t } = useTranslation();
  const outcomes = result.providerOutcomes ?? [];
  const summary =
    outcomes.length === 0
      ? t(`settings.pricing.status.${result.status}`)
      : t('settings.pricing.toastSummary', {
          applied: outcomes.filter((outcome) => outcome.status === 'applied').length,
          unchanged: outcomes.filter((outcome) => outcome.status === 'no_change').length,
          rejected: outcomes.filter((outcome) => outcome.status === 'rejected_validation').length,
          fetchFailed: outcomes.filter((outcome) => outcome.status === 'fetch_failed').length,
          extractionFailed: outcomes.filter((outcome) => outcome.status === 'extraction_failed').length,
        });
  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 max-w-lg rounded border border-border bg-surface px-4 py-3 text-text shadow-lg"
      role="status"
    >
      {summary}
    </div>
  );
}
