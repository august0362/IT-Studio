import { PipelineStage, type PipelineRun, type ProjectId } from '@itstudio/schemas';
import { Editor } from '@monaco-editor/react';
import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Money } from '../../components/Money';
import { useNotification } from '../../hooks/use-notification';
import { useRpcClient } from '../../rpc/rpc-context';
import { CommandOutput } from './CommandOutput';
import { DiffViewer } from './DiffViewer';
import { FailureReportPanel } from './FailureReportPanel';
import { PromptBox } from './PromptBox';
import { ReviewView } from './ReviewView';
import { RunHistory } from './RunHistory';
import { SpecView } from './SpecView';
import { StageTimeline } from './StageTimeline';
import { initialPipelineState, pipelineReducer } from './pipeline-store';
import './monaco-setup';

const busyStages: readonly string[] = [
  PipelineStage.SPECIFYING,
  PipelineStage.CODING,
  PipelineStage.REVIEWING,
  PipelineStage.FIXING,
  PipelineStage.RE_REVIEWING,
  PipelineStage.WRITING,
  PipelineStage.VALIDATING,
];

export function CodePage({ projectId }: { readonly projectId: ProjectId | null }): JSX.Element {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const [state, dispatch] = useReducer(pipelineReducer, initialPipelineState);
  const [starting, setStarting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ['pipeline.list', { projectId, limit: 20 }],
    queryFn: () => (projectId === null ? Promise.resolve([]) : rpc.call('pipeline.list', { projectId, limit: 20 })),
    enabled: projectId !== null,
    refetchInterval: 10_000,
  });
  const selectedId = state.selectedRunId;
  const selected = selectedId === null ? undefined : state.entries[selectedId];
  const runs = useMemo(
    () => [...(history.data ?? [])].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)),
    [history.data],
  );
  const active = selected !== undefined && !selected.finished && busyStages.includes(selected.run.stage);

  useNotification('pipeline.event', (event) => {
    dispatch({ type: 'event', event });
    void rpc
      .call('pipeline.get', { runId: event.runId })
      .then((run) => {
        dispatch({ type: 'loaded', run });
      })
      .catch(() => undefined);
    void history.refetch();
  });
  useNotification('pipeline.failureReport', (report) => {
    dispatch({ type: 'failure', report });
    if (report.runId !== undefined)
      void rpc
        .call('pipeline.get', { runId: report.runId })
        .then((run) => {
          dispatch({ type: 'loaded', run });
        })
        .catch(() => undefined);
  });

  useEffect(() => {
    for (const run of runs) if (state.entries[run.id] === undefined) dispatch({ type: 'started', run });
  }, [runs, state.entries]);

  async function start(prompt: string): Promise<void> {
    if (projectId === null) return;
    setStarting(true);
    setActionError(null);
    try {
      const run = await rpc.call('pipeline.start', { projectId, prompt });
      dispatch({ type: 'started', run });
      await history.refetch();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : t('code.actionError'));
    } finally {
      setStarting(false);
    }
  }

  async function cancel(): Promise<void> {
    if (selected === undefined) return;
    setConfirmCancel(false);
    try {
      const run = await rpc.call('pipeline.cancel', { runId: selected.run.id });
      dispatch({ type: 'loaded', run });
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : t('code.actionError'));
    }
  }

  function selectRun(run: PipelineRun): void {
    void rpc
      .call('pipeline.get', { runId: run.id })
      .then((loaded) => {
        dispatch({ type: 'loaded', run: loaded });
      })
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : t('code.actionError'));
      });
  }

  const requiresConfirm =
    selected?.run.stage === PipelineStage.WRITING || selected?.run.stage === PipelineStage.VALIDATING;
  const outputEntries = selected === undefined ? [] : Object.entries(selected.outputs);
  return (
    <section className="space-y-5" aria-labelledby="code-heading">
      <h2 className="text-xl font-semibold" id="code-heading">
        {t('code.heading')}
      </h2>
      {projectId === null ? <p role="status">{t('code.pickProject')}</p> : null}
      <PromptBox
        busy={starting || (selected?.queued ?? false)}
        disabled={projectId === null}
        onRun={(prompt) => {
          void start(prompt);
        }}
      />
      {actionError !== null ? (
        <p className="text-danger" role="alert">
          {actionError}
        </p>
      ) : null}
      {history.isError ? (
        <p className="text-danger" role="alert">
          {t('code.historyError')}
        </p>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <div className="min-w-0 space-y-4">
          {selected === undefined ? (
            <p className="text-text-muted">{t('code.empty')}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <StageTimeline run={selected.run} />
                <div className="space-y-2">
                  {selected.queued ? <p role="status">{t('code.queued')}</p> : null}
                  <Money value={selected.run.cost} />
                  {active ? (
                    <button
                      className="rounded border border-danger px-3 py-2"
                      onClick={() => {
                        if (requiresConfirm) setConfirmCancel(true);
                        else void cancel();
                      }}
                      type="button"
                    >
                      {t('code.cancel')}
                    </button>
                  ) : null}
                </div>
              </div>
              {selected.run.spec !== undefined ? <SpecView spec={selected.run.spec} /> : null}
              {selected.run.coderOutputs.map((output, index) => (
                <section className="space-y-3" key={`${selected.run.id}-coder-${index.toString()}`}>
                  <h3 className="font-semibold">{output.summary}</h3>
                  {output.operations.map((operation, opIndex) =>
                    operation.kind === 'delete' || operation.kind === 'rename' ? (
                      <p key={`${opIndex.toString()}-${operation.kind}`}>
                        {operation.kind === 'rename' ? `${operation.from} → ${operation.to}` : operation.path}
                      </p>
                    ) : (
                      <DiffViewer
                        after={operation.kind === 'patch' ? operation.unifiedDiff : operation.content}
                        before=""
                        key={`${opIndex.toString()}-${operation.path}`}
                        path={operation.path}
                      />
                    ),
                  )}
                </section>
              ))}
              {selected.run.verdicts.map((verdict, index) => (
                <ReviewView key={`${selected.run.id}-review-${index.toString()}`} verdict={verdict} />
              ))}
              {outputEntries.map(([id, output]) => (
                <CommandOutput commandId={id} key={id} output={output} />
              ))}
              {selected.run.validation?.map((command) => (
                <div className="rounded border border-border p-3" key={command.id}>
                  <h4>
                    {command.spec.kind} · {command.exitCode === 0 ? t('code.passed') : t('code.failed')}
                  </h4>
                  <pre>{command.stdoutTail}</pre>
                  <pre className="text-danger">{command.stderrTail}</pre>
                </div>
              ))}
              {selected.run.failureReport !== undefined ? (
                <FailureReportPanel report={selected.run.failureReport} />
              ) : null}
            </>
          )}
        </div>
        <aside className="space-y-4">
          <RunHistory runs={runs} selected={selectedId} onSelect={selectRun} />
          {selected !== undefined ? (
            <div>
              <h3 className="font-semibold">{t('code.preview')}</h3>
              <Editor
                height="240px"
                language="markdown"
                options={{ readOnly: true, minimap: { enabled: false } }}
                value={selected.run.prompt}
                theme="itstudio-active"
              />
            </div>
          ) : null}
        </aside>
      </div>
      <ConfirmDialog
        cancelLabel={t('code.keepWorking')}
        confirmLabel={t('code.confirmCancel')}
        message={t('code.rollbackWarning')}
        onCancel={() => {
          setConfirmCancel(false);
        }}
        onConfirm={() => {
          void cancel();
        }}
        open={confirmCancel}
        title={t('code.confirmTitle')}
        tone="danger"
      />
    </section>
  );
}
