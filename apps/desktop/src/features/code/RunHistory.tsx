import type { PipelineRun } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

export function RunHistory({
  runs,
  selected,
  onSelect,
}: {
  readonly runs: readonly PipelineRun[];
  readonly selected: string | null;
  readonly onSelect: (run: PipelineRun) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <section>
      <h3 className="mb-2 font-semibold">{t('code.history')}</h3>
      <ul className="space-y-1">
        {runs.map((run) => (
          <li key={run.id}>
            <button
              aria-current={selected === run.id ? 'true' : undefined}
              className="w-full rounded border border-border p-2 text-left hover:bg-surface-alt"
              onClick={() => {
                onSelect(run);
              }}
              type="button"
            >
              {run.prompt.slice(0, 80)} · {t(`code.stages.${run.stage}`)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
