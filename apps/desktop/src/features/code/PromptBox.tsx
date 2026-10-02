import { useState, type JSX, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';

const MAX_PROMPT = 8000;
export function PromptBox({
  disabled,
  busy,
  onRun,
}: {
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly onRun: (prompt: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!disabled && !busy && prompt.trim().length > 0) onRun(prompt.trim());
  }
  return (
    <form className="space-y-2" onSubmit={submit}>
      <label className="block font-medium" htmlFor="pipeline-prompt">
        {t('code.prompt')}
      </label>
      <textarea
        id="pipeline-prompt"
        className="min-h-28 w-full rounded border border-border bg-surface p-3"
        maxLength={MAX_PROMPT}
        value={prompt}
        onChange={(event) => {
          setPrompt(event.target.value);
        }}
        disabled={disabled || busy}
      />
      <div className="flex items-center justify-between text-sm text-text-muted">
        <span>{t('code.counter', { count: prompt.length })}</span>
        <button
          className="rounded bg-primary px-4 py-2 text-primary-fg disabled:opacity-50"
          disabled={disabled || busy || prompt.trim().length === 0}
          type="submit"
        >
          {busy ? t('code.queued') : t('code.run')}
        </button>
      </div>
    </form>
  );
}
