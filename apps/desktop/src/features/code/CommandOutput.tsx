import type { CommandOutputState } from './pipeline-store';
import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export function CommandOutput({
  commandId,
  output,
}: {
  readonly commandId: string;
  readonly output: CommandOutputState;
}): JSX.Element {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    if (stick.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [output]);
  return (
    <section className="rounded border border-border p-3">
      <h4>{t('code.command', { id: commandId })}</h4>
      {output.truncated ? <p>{t('code.truncated')}</p> : null}
      <div
        className="max-h-64 overflow-auto"
        onScroll={(event) => {
          const element = event.currentTarget;
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 8;
        }}
        ref={ref}
      >
        <h5>{t('code.stdout')}</h5>
        <pre className="whitespace-pre-wrap">{output.stdout}</pre>
        <h5>{t('code.stderr')}</h5>
        <pre className="whitespace-pre-wrap text-danger">{output.stderr}</pre>
      </div>
    </section>
  );
}
