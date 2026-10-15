import type { ProjectId } from '@itstudio/schemas';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Money } from '../../components/Money';
import { useNotification } from '../../hooks/use-notification';
import { formatDateTime } from '../../i18n/format';
import { StudioGraph } from './StudioGraph';
import { StudioPanel } from './StudioPanel';
import {
  finalModule,
  isFinished,
  moduleStatuses,
  runPath,
  STAGE_MODULE,
  writeLayout,
  type ModuleId,
} from './studio-model';
import { useStudioAnimation } from './useStudioAnimation';
import { useStudioRuns } from './useStudioRuns';
import './studio.css';

interface PageProps {
  readonly projectId: ProjectId | null;
  readonly projectName?: string | undefined;
  readonly onBack: () => void;
}

function StudioPage({ projectId, projectName, onBack }: PageProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const data = useStudioRuns(projectId);
  const animation = useStudioAnimation();
  const { transition, replay, clear } = animation;
  const [panel, setPanel] = useState<ModuleId | null>(null);
  const [prompt, setPrompt] = useState('');
  const [fitRevision, setFitRevision] = useState(0);
  const [resetRevision, setResetRevision] = useState(0);
  const run = data.selected;
  const finished = run !== undefined && isFinished(run);
  const statuses = moduleStatuses(run, data.entered, finished, data.queued);
  const previous = useRef<{ readonly runId: string; readonly module: ModuleId } | null>(null);
  const current = run === undefined ? 'request' : data.queued ? 'request' : finalModule(run, data.entered);
  useEffect(() => {
    if (run === undefined) return;
    if (previous.current?.runId !== run.id) {
      clear();
      setPanel(null);
      if (!isFinished(run) && !data.queued) replay(runPath(run, data.entered));
    } else if (previous.current.module !== current) transition(previous.current.module, current);
    previous.current = { runId: run.id, module: current };
  }, [run, current, data.queued, data.entered, clear, replay, transition]);
  // Observe stage events directly so rapid transitions survive overlapping snapshot refetches.
  useNotification('pipeline.event', (event) => {
    if (event.runId !== run?.id || previous.current?.runId !== run.id) return;
    if (event.type !== 'stage' && event.type !== 'finished') return;
    if (['failed', 'rolled_back', 'cancelled'].includes(event.stage)) return;
    const next = STAGE_MODULE[event.stage];
    transition(previous.current.module, next);
    previous.current = { runId: run.id, module: next };
  });
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (panel !== null) setPanel(null);
      else onBack();
    };
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('keydown', escape);
    };
  }, [panel, onBack]);
  const select = useCallback((id: ModuleId): void => {
    setPanel(id);
  }, []);
  const close = useCallback((): void => {
    setPanel(null);
  }, []);
  return (
    <section
      className="studio-root fixed inset-0 overflow-hidden"
      style={{ background: 'black' }}
      aria-label={t('nav.pipelineStudio')}
    >
      <header className="studio-topbar">
        <button type="button" onClick={onBack}>
          {t('pipelineStudio.back')}
        </button>
        <div>
          <h1>{t('nav.pipelineStudio')}</h1>
          <p>{projectName ?? t('pipelineStudio.noProject')}</p>
        </div>
        <label>
          {t('pipelineStudio.run')}
          <select
            disabled={data.runs.length === 0}
            value={run?.id ?? ''}
            onChange={(event) => {
              const target = data.runs.find((item) => item.id === event.target.value);
              if (target !== undefined) data.select(target.id);
            }}
          >
            {data.runs.map((item) => (
              <option key={item.id} value={item.id}>
                {formatDateTime(item.startedAt, i18n.language)} · {item.prompt.slice(0, 50)}
              </option>
            ))}
          </select>
        </label>
        <div className="studio-run-status" aria-live="polite">
          {run === undefined ? null : (
            <>
              <span>{data.queued ? t('pipelineStudio.states.waiting') : t(`code.stages.${run.stage}`)}</span>
              <Money value={run.cost} />
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setFitRevision((value) => value + 1);
          }}
        >
          {t('pipelineStudio.fit')}
        </button>
        <button
          type="button"
          onClick={() => {
            writeLayout({});
            setResetRevision((value) => value + 1);
          }}
        >
          {t('pipelineStudio.reset')}
        </button>
        <button
          type="button"
          disabled={!finished}
          onClick={() => {
            if (run !== undefined) animation.replay(runPath(run, data.entered));
          }}
        >
          {t('pipelineStudio.replay')}
        </button>
      </header>
      <form
        className="studio-request"
        onSubmit={(event) => {
          event.preventDefault();
          const value = prompt.trim();
          if (value)
            void data.start(value).then((started) => {
              if (started) setPrompt('');
            });
        }}
      >
        <label htmlFor="studio-new-request">{t('pipelineStudio.newRequest')}</label>
        <input
          id="studio-new-request"
          value={prompt}
          maxLength={32000}
          disabled={projectId === null || data.busy}
          onChange={(event) => {
            setPrompt(event.target.value);
          }}
          aria-describedby={projectId === null ? 'studio-project-hint' : undefined}
        />
        <button type="submit" disabled={projectId === null || data.busy || !prompt.trim()}>
          {t('pipelineStudio.start')}
        </button>
      </form>
      {data.error === null ? null : (
        <p className="studio-alert" role="alert">
          {data.error}
        </p>
      )}
      {projectId === null ? (
        <p id="studio-project-hint" className="studio-empty" role="status">
          {t('pipelineStudio.noProject')}
        </p>
      ) : (
        <>
          {run === undefined ? (
            <p className="studio-empty" role="status">
              {t(data.loading ? 'pipelineStudio.loading' : 'pipelineStudio.empty')}
            </p>
          ) : null}
          <StudioGraph
            key={resetRevision}
            run={run}
            statuses={statuses}
            packet={animation.packet}
            pulse={animation.pulse}
            onSelect={select}
            onCanvasClick={close}
            fitRevision={fitRevision}
            resetRevision={resetRevision}
          />
        </>
      )}
      {panel === null ? null : (
        <StudioPanel
          key={`${run?.id ?? ''}-${panel}`}
          module={panel}
          status={statuses[panel]}
          run={run}
          busy={data.busy}
          outputs={data.outputs}
          onAnswer={(answers) => {
            void data.answer(answers);
          }}
          onClose={close}
        />
      )}
    </section>
  );
}
export function PipelineStudioPage(props: PageProps): JSX.Element {
  return <StudioPage key={props.projectId ?? 'no-project'} {...props} />;
}
