import type { FallbackDecisionRequest, FallbackDecision } from '@itstudio/schemas';
import type { JSX, KeyboardEvent } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Money } from '../../components/Money';

export function FallbackModal({
  request,
  names,
  onDecision,
  onExpire,
}: {
  readonly request: FallbackDecisionRequest;
  readonly names: Readonly<Record<string, string>>;
  readonly onDecision: (decision: FallbackDecision) => void;
  readonly onExpire: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    const updateRemaining = () => {
      setRemaining(Math.max(0, Date.parse(request.expiresAt) - Date.now()));
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [request.expiresAt]);
  useEffect(() => {
    if (remaining === 0) onExpire();
  }, [remaining, onExpire]);
  function trapFocus(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDecision({ requestId: request.requestId, action: 'abort' });
    }
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)')];
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/80 p-4" onKeyDown={trapFocus}>
      <section
        aria-labelledby="fallback-heading"
        aria-modal="true"
        className="w-full max-w-lg rounded border border-border bg-surface p-5 shadow-xl"
        role="dialog"
        tabIndex={-1}
      >
        <h2 className="mb-2 text-lg font-semibold" id="fallback-heading">
          {t('chat.fallbackTitle')}
        </h2>
        <p>{t('chat.fallbackPrompt', { model: names[request.failedModel] ?? request.failedModel })}</p>
        <p className="my-2" role="timer">
          {t('chat.timeLeft', { seconds: Math.ceil((remaining ?? 0) / 1000) })}
        </p>
        <ul className="space-y-2">
          {request.candidates.map((candidate) => (
            <li className="flex items-center justify-between gap-2" key={candidate.modelKey}>
              <span>{names[candidate.modelKey] ?? candidate.modelKey}</span>
              {candidate.estimatedCost === undefined ? <span>—</span> : <Money value={candidate.estimatedCost} />}
              <button
                className="rounded border border-border px-3 py-2"
                onClick={() => {
                  onDecision({ requestId: request.requestId, action: 'use_model', modelKey: candidate.modelKey });
                }}
                type="button"
              >
                {t('chat.use')}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded border border-border px-3 py-2"
            onClick={() => {
              onDecision({ requestId: request.requestId, action: 'retry_same' });
            }}
            type="button"
          >
            {t('chat.retrySame')}
          </button>
          <button
            autoFocus
            className="rounded border border-border px-3 py-2"
            onClick={() => {
              onDecision({ requestId: request.requestId, action: 'abort' });
            }}
            type="button"
          >
            {t('chat.cancel')}
          </button>
        </div>
      </section>
    </div>
  );
}
