import { PipelineStage, type PipelineRun, type ProjectId, type RpcMethodMap, type AppError } from '@itstudio/schemas';
import { Editor } from '@monaco-editor/react';
import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Money } from '../../components/Money';
import { useNotification } from '../../hooks/use-notification';
import { ErrorPanel } from '../../components/ErrorPanel';
import { RpcCallError } from '../../rpc/rpc-client';
import { useRpcClient } from '../../rpc/rpc-context';
import { CommandOutput } from './CommandOutput';
import { ClarificationForm } from './ClarificationForm';
import { DiffViewer } from './DiffViewer';
import { FailureReportPanel } from './FailureReportPanel';
import { PromptBox } from './PromptBox';
import { ReviewView } from './ReviewView';
import { RunHistory } from './RunHistory';
import { SpecView } from './SpecView';
import { StageTimeline } from './StageTimeline';
import { initialPipelineState, pipelineReducer } from './pipeline-store';
import './monaco-setup';
import { useNavigationIntent } from '../../state/navigation-intent';

const busyStages: readonly string[] = [
  PipelineStage.SPECIFYING,
  PipelineStage.CLARIFYING,
  PipelineStage.CODING,
  PipelineStage.REVIEWING,
  PipelineStage.FIXING,
  PipelineStage.RE_REVIEWING,
  PipelineStage.WRITING,
  PipelineStage.VALIDATING,
];

export function CodePage({ projectId }: { readonly projectId: ProjectId | null }): JSX.Element {
  return <ProjectCodePage key={projectId} projectId={projectId} />;
}

function ProjectCodePage({ projectId }: { readonly projectId: ProjectId | null }): JSX.Element {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const [state, dispatch] = useReducer(pipelineReducer, initialPipelineState);
  const [startError, setStartError] = useState<AppError | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const loadSequences = useRef(new Map<PipelineRun['id'], number>());
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
  const navigationIntent = useNavigationIntent((value) => value.intent);
  const clearNavigationIntent = useNavigationIntent((value) => value.clearIntent);
  const active = selected !== undefined && !selected.finished && busyStages.includes(selected.run.stage);

  const loadRun = useCallback(
    async (runId: PipelineRun['id']): Promise<void> => {
      const sequence = (loadSequences.current.get(runId) ?? 0) + 1;
      loadSequences.current.set(runId, sequence);
      const run = await rpc.call('pipeline.get', { runId });
      if (loadSequences.current.get(runId) === sequence && run.projectId === projectId)
        dispatch({ type: 'loaded', run });
    },
    [projectId, rpc],
  );
  const selectRun = useCallback(
    (run: PipelineRun): void => {
      void loadRun(run.id).catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : t('code.actionError'));
      });
    },
    [loadRun, t],
  );

  useNotification('pipeline.event', (event) => {
    dispatch({ type: 'event', event });
    void loadRun(event.runId).catch(() => undefined);
    void history.refetch();
  });
  useNotification('pipeline.failureReport', (report) => {
    dispatch({ type: 'failure', report });
    if (report.runId !== undefined) void loadRun(report.runId).catch(() => undefined);
  });

  useEffect(() => {
    for (const run of runs) if (state.entries[run.id] === undefined) dispatch({ type: 'started', run });
  }, [runs, state.entries]);

  useEffect(() => {
    if (navigationIntent?.kind !== 'pipelineRun') return;
    const run = runs.find((item) => item.id === navigationIntent.id);
    if (run === undefined) return;
    selectRun(run);
    clearNavigationIntent();
  }, [clearNavigationIntent, navigationIntent, runs, selectRun]);

  async function start(prompt: string): Promise<void> {
    if (projectId === null) return;
    setStarting(true);
    setActionError(null);
    setStartError(null);
    try {
      const run = await rpc.call('pipeline.start', { projectId, prompt });
      dispatch({ type: 'started', run });
      await history.refetch();
    } catch (error: unknown) {
      setStartError(
        error instanceof RpcCallError
          ? error.appError
          : {
              code: 'INTERNAL',
              message: error instanceof Error ? error.message : t('code.actionError'),
              retryable: false,
              remediation: [t('code.retryStart')],
            },
      );
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

  async function answerClarifications(
    answers: RpcMethodMap['pipeline.answerClarifications']['params']['answers'],
  ): Promise<void> {
    if (selected === undefined) return;
    setActionError(null);
    try {
      const run = await rpc.call('pipeline.answerClarifications', { runId: selected.run.id, answers });
      dispatch({ type: 'loaded', run });
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : t('code.actionError'));
    }
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
      {startError !== null ? (
        <div>
          <ErrorPanel error={startError} />
          {startError.code === 'VALIDATION' ? (
            <button
              className="mt-2 rounded border border-border px-3 py-2"
              type="button"
              onClick={() => {
                window.location.hash = 'settings-pipeline';
              }}
            >
              {t('code.openPipelineSettings')}
            </button>
          ) : null}
        </div>
      ) : null}
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
              {selected.run.clarifications !== undefined ? (
                <ClarificationForm
                  key={selected.run.id}
                  onSubmit={(answers) => {
                    void answerClarifications(answers);
                  }}
                  questions={selected.run.clarifications}
                  readOnly={selected.run.stage !== PipelineStage.CLARIFYING}
                  runId={selected.run.id}
                />
              ) : null}
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
