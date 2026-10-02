import type { JSX, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

export function Composer({
  value,
  busy,
  onChange,
  onSend,
  onStop,
}: {
  readonly value: string;
  readonly busy: boolean;
  readonly onChange: (value: string) => void;
  readonly onSend: () => void;
  readonly onStop: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !busy && value.trim().length > 0) {
      event.preventDefault();
      onSend();
    }
  }
  return (
    <div className="flex items-end gap-2 border-t border-border p-3">
      <label className="sr-only" htmlFor="chat-composer">
        {t('chat.message')}
      </label>
      <textarea
        className="min-h-12 flex-1 resize-y rounded border border-border bg-surface p-2"
        id="chat-composer"
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        onKeyDown={handleKeyDown}
        value={value}
      />
      {busy ? (
        <button className="rounded border border-border px-3 py-2" onClick={onStop} type="button">
          {t('chat.stop')}
        </button>
      ) : (
        <button
          className="rounded bg-primary px-3 py-2 text-primary-fg disabled:opacity-50"
          disabled={!value.trim()}
          onClick={onSend}
          type="button"
        >
          {t('chat.send')}
        </button>
      )}
    </div>
  );
}
