import type { PipelineRun, RpcMethodMap } from '@itstudio/schemas';
import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Money } from '../../components/Money';
import { SafeMarkdown } from '../../components/SafeMarkdown';
import { formatDateTime } from '../../i18n/format';
import { ClarificationForm } from '../code/ClarificationForm';
import { CommandOutput } from '../code/CommandOutput';
import { DiffViewer } from '../code/DiffViewer';
import { FailureReportPanel } from '../code/FailureReportPanel';
import { ReviewView } from '../code/ReviewView';
import { SpecView } from '../code/SpecView';
import type { CommandOutputState } from '../code/pipeline-store';
import '../code/monaco-setup';
import { CONNECTIONS, type ModuleId, type ModuleStatus } from './studio-model';
import { StudioCommandDetails } from './StudioCommandDetails';

function CoderDetails({ run, index }: { readonly run: PipelineRun; readonly index: number }): JSX.Element | null {
  const { t } = useTranslation();
  const output = run.coderOutputs[index];
  if (output === undefined) return null;
  return (
    <section className="space-y-3">
      <SafeMarkdown source={output.summary} />
      <h3>{t('pipelineStudio.assumptions')}</h3>
      {output.assumptions.map((text, i) => (
        <SafeMarkdown key={i} source={text} />
      ))}
      {output.operations.map((operation, i) => (
        <div className="space-y-2" key={i}>
          <p>
            {operation.kind} · {operation.kind === 'rename' ? `${operation.from} → ${operation.to}` : operation.path}
          </p>
          {'baseHash' in operation ? (
            <p className="break-all">
              {t('pipelineStudio.baseHash')}: {operation.baseHash}
            </p>
          ) : null}
          {operation.kind === 'create' || operation.kind === 'replace' || operation.kind === 'patch' ? (
            <DiffViewer
              path={operation.path}
              before=""
              after={operation.kind === 'patch' ? operation.unifiedDiff : operation.content}
            />
          ) : null}
        </div>
      ))}
    </section>
  );
}

export function StudioPanel({
  module,
  status,
  run,
  outputs,
  busy,
  onAnswer,
  onClose,
  children,
}: {
  readonly module: ModuleId;
  readonly status: ModuleStatus;
  readonly run: PipelineRun | undefined;
  readonly outputs: Readonly<Record<string, CommandOutputState>>;
  readonly busy: boolean;
  readonly onAnswer: (answers: RpcMethodMap['pipeline.answerClarifications']['params']['answers']) => void;
  readonly onClose: () => void;
  readonly children?: ReactNode;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <aside
      className={`studio-panel studio-panel-fixed studio-${status}`}
      role="dialog"
      aria-labelledby="studio-panel-title"
      ref={panel}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const elements = [
          ...(panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]',
          ) ?? []),
        ];
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus({ preventScroll: true });
        }
      }}
    >
      <header className="studio-panel-header">
        <h2 id="studio-panel-title">{t(`pipelineStudio.modules.${module}`)}</h2>
        <button ref={close} type="button" aria-label={t('pipelineStudio.close')} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="studio-panel-body space-y-4">
        {children}
        <p>
          {t('pipelineStudio.status')}: {t(`pipelineStudio.states.${status}`)}
        </p>
        <p>
          {t('pipelineStudio.incoming')}:{' '}
          {CONNECTIONS.filter(([, to]) => to === module)
            .map(([from]) => t(`pipelineStudio.modules.${from}`))
            .join(', ') || '—'}
        </p>
        <p>
          {t('pipelineStudio.outgoing')}:{' '}
          {CONNECTIONS.filter(([from]) => from === module)
            .map(([, to]) => t(`pipelineStudio.modules.${to}`))
            .join(', ') || '—'}
        </p>
        {run === undefined ? (
          <p>{t('pipelineStudio.empty')}</p>
        ) : (
          <>
            <p>
              {t('pipelineStudio.runStarted')}:{' '}
              <time dateTime={run.startedAt}>{formatDateTime(run.startedAt, i18n.language)}</time>
            </p>
            {run.finishedAt === undefined ? null : (
              <p>
                {t('pipelineStudio.runFinished')}:{' '}
                <time dateTime={run.finishedAt}>{formatDateTime(run.finishedAt, i18n.language)}</time>
              </p>
            )}
            <p className="text-sm">{t('pipelineStudio.stageTimingUnavailable')}</p>
            {module === 'request' ? (
              <>
                <SafeMarkdown source={run.prompt} />
                <h3>{t('pipelineStudio.roles')}</h3>
                <dl className="space-y-2">
                  {(['pm', 'coder', 'reviewer'] as const).map((role) => (
                    <div key={role}>
                      <dt>{t(`pipelineStudio.roleNames.${role}`)}</dt>
                      <dd>
                        {run.roleAssignment[role].length === 0 ? (
                          <p>{t('pipelineStudio.noRoleModels')}</p>
                        ) : (
                          <ol className="list-decimal pl-5" aria-label={t(`pipelineStudio.roleNames.${role}`)}>
                            {run.roleAssignment[role].map((model, index) => (
                              <li key={index}>{model}</li>
                            ))}
                          </ol>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : null}
            {module === 'clarify' ? (
              run.clarifications?.length ? (
                <fieldset disabled={busy}>
                  <ClarificationForm
                    key={run.id}
                    runId={run.id}
                    questions={run.clarifications}
                    readOnly={run.stage !== 'clarifying'}
                    onSubmit={onAnswer}
                  />
                </fieldset>
              ) : (
                <p>{t('pipelineStudio.noQuestions')}</p>
              )
            ) : null}
            {module === 'spec' && run.spec !== undefined ? (
              <>
                <SpecView spec={run.spec} />
                <h3>{t('pipelineStudio.outOfScope')}</h3>
                {run.spec.outOfScope.map((text, i) => (
                  <SafeMarkdown key={i} source={text} />
                ))}
              </>
            ) : null}
            {module === 'code' ? <CoderDetails run={run} index={0} /> : null}
            {module === 'review' || module === 're-review'
              ? run.verdicts.slice(module === 'review' ? 0 : 1, module === 'review' ? 1 : 2).map((verdict, i) => (
                  <div key={i}>
                    <ReviewView verdict={verdict} />
                    {verdict.findings.map((finding, j) => (
                      <p key={j}>
                        {t('pipelineStudio.category')}: {finding.category}
                      </p>
                    ))}
                  </div>
                ))
              : null}
            {module === 'fix' ? (
              <>
                <p>{t('pipelineStudio.fixAttempts', { count: run.fixAttempts })}</p>
                <CoderDetails run={run} index={1} />
              </>
            ) : null}
            {module === 'write' ? (
              <>
                <h3>{t('pipelineStudio.transaction')}</h3>
                <p className="break-all">{run.transactionId ?? '—'}</p>
                <CoderDetails run={run} index={run.coderOutputs.length - 1} />
              </>
            ) : null}
            {module === 'validate' ? (
              <>
                {run.validation?.map((command) => (
                  <StudioCommandDetails key={command.id} command={command} output={outputs[command.id]} />
                ))}
                {Object.entries(outputs)
                  .filter(([id]) => !run.validation?.some((command) => command.id === id))
                  .map(([id, output]) => (
                    <CommandOutput key={id} commandId={id} output={output} />
                  ))}
              </>
            ) : null}
            {module === 'done' ? (
              <>
                <p>{t(`code.stages.${run.stage}`)}</p>
                <Money value={run.cost} />
                {run.finishedAt === undefined ? null : (
                  <p>
                    {t('pipelineStudio.duration', {
                      seconds: Math.max(0, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000)),
                    })}
                  </p>
                )}
                {run.failureReport === undefined ? null : (
                  <>
                    <FailureReportPanel report={run.failureReport} />
                    <p className="break-all">{run.failureReport.restoredSnapshot}</p>
                    <pre className="whitespace-pre-wrap">{run.failureReport.logExcerpt}</pre>
                  </>
                )}
              </>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
