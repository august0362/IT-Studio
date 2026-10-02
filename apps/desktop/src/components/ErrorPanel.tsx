import type { AppError } from '@itstudio/schemas';
import type { JSX } from 'react';
import { neutralClasses } from './ui/neutral-classes';

export interface ErrorPanelProps {
  readonly error: AppError;
  readonly onRetry?: () => void;
}

export function ErrorPanel({ error, onRetry }: ErrorPanelProps): JSX.Element {
  return (
    <section className="mt-2 text-sm font-medium" role="alert">
      <p>{error.message}</p>
      {error.remediation !== undefined ? (
        <ol className="list-decimal pl-5">
          {error.remediation.map((step, index) => (
            <li key={`${index.toString()}-${step}`}>{step}</li>
          ))}
        </ol>
      ) : null}
      <small className={`mt-1 block ${neutralClasses.secondaryText}`}>{error.code}</small>
      {error.retryable && onRetry !== undefined ? (
        <button
          className={`mt-2 rounded border ${neutralClasses.controlBorder} px-3 py-2 ${neutralClasses.hoverSurface}`}
          onClick={onRetry}
          type="button"
        >
          Retry
        </button>
      ) : null}
    </section>
  );
}
