import type { ModelKey, PricingExtractionOptions } from '@itstudio/schemas';
import { useTranslation } from 'react-i18next';
import { Money } from '../../../components/Money';

interface PricingExtractionControlProps {
  readonly extraction: PricingExtractionOptions | undefined;
  readonly disabled: boolean;
  readonly onSelect: (modelKey: ModelKey) => void;
}

export function PricingExtractionControl({ extraction, disabled, onSelect }: PricingExtractionControlProps) {
  const { t } = useTranslation();
  const selected = extraction?.options.find((option) => option.modelKey === extraction.selectedModelKey);
  return (
    <div className="space-y-3 rounded border border-border bg-surface p-4">
      <label className="grid gap-1">
        <span>{t('settings.pricing.extractionModel')}</span>
        <select
          className="rounded border border-border bg-bg p-2"
          disabled={disabled || !extraction || extraction.options.length === 0}
          onChange={(event) => {
            const option = extraction?.options.find((candidate) => candidate.modelKey === event.target.value);
            if (option) onSelect(option.modelKey);
          }}
          value={extraction?.selectedModelKey ?? ''}
        >
          {!selected ? <option value="">{t('settings.pricing.noExtractionModel')}</option> : null}
          {(extraction?.options ?? []).map((option) => (
            <option key={option.modelKey} value={option.modelKey}>
              {option.displayName}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <div className="space-y-1 text-sm">
          <p>{t('settings.pricing.estimate', { calls: extraction?.calls })}</p>
          <Money value={selected.estimatedCost} />
          <p className="text-text-muted">{t('settings.pricing.estimateHelp')}</p>
        </div>
      ) : (
        <p className="text-sm text-text-muted" role="status">
          {extraction ? t('settings.pricing.addKey') : t('settings.pricing.estimateUnavailable')}
        </p>
      )}
    </div>
  );
}
