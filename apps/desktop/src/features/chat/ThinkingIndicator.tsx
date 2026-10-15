import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

export function ThinkingIndicator(): JSX.Element {
  const { t } = useTranslation();
  return (
    <span aria-live="polite" className="flex items-center gap-2 text-text-muted" role="status">
      <span aria-hidden="true" className="flex gap-1">
        {[0, 1, 2].map((index) => (
          <span
            className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-bounce motion-reduce:animate-none"
            key={index}
            style={{ animationDelay: `${String(index * 150)}ms` }}
          />
        ))}
      </span>
      {t('chat.thinking')}
    </span>
  );
}
