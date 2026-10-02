import type { MoneyDisplay } from '@itstudio/schemas';
import type { JSX } from 'react';

export interface MoneyProps {
  readonly value: MoneyDisplay;
  readonly compact?: boolean;
}

export function Money({ value, compact = false }: MoneyProps): JSX.Element {
  const isNegative = value.microUsd < 0;
  const amountClass = isNegative ? 'text-danger' : '';
  const ariaLabel = `USD ${value.usdText}; VND ${value.vndText}`;

  if (compact) {
    return (
      <span aria-label={ariaLabel} className={amountClass}>
        {value.usdText} · {value.vndText}
      </span>
    );
  }

  return (
    <span aria-label={ariaLabel} className="inline-flex flex-col">
      <span className={amountClass}>{value.usdText}</span>
      <span className={`text-sm text-text-muted ${amountClass}`}>{value.vndText}</span>
    </span>
  );
}
