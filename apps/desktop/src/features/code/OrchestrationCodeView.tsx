import { OrchRunState, type OrchRun, type ProjectId } from '@itstudio/schemas';
import { startTransition, useEffect, useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/ui/PageHeader';
import { useNotification } from '../../hooks/use-notification';
import { useRpcQuery } from '../../hooks/use-rpc-query';
import { ProcessGraph } from '../processes/ProcessGraph';
import { useRpcClient } from '../../rpc/rpc-context';
import { useNavigationIntent } from '../../state/navigation-intent';

const activeStates: readonly string[] = [OrchRunState.RUNNING, OrchRunState.PAUSED, OrchRunState.PAUSED_INTERRUPTED];
export function OrchestrationCodeView({ projectId }: { readonly projectId: ProjectId | null }): JSX.Element {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const [request, setRequest] = useState('');
  const [run, setRun] = useState<OrchRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const list = useRpcQuery('orch.list', { ...(projectId === null ? {} : { projectId }), limit: 20 });
  const processList = useRpcQuery('process.list', {
    ...(projectId === null ? {} : { projectId }),
    kind: ['orchestration'],
    limit: 100,
  });
  const adapters = useRpcQuery('orch.adapters', {});
  const roles = useRpcQuery('settings.get', {});
  const intent = useNavigationIntent((state) => state.intent);
  const clearIntent = useNavigationIntent((state) => state.clearIntent);
  const attempts = useQuery({
    queryKey: ['orch.attempts', run?.id],
    queryFn: () => (run === null ? Promise.resolve([]) : rpc.call('orch.attempts', { runId: run.id })),
    enabled: run !== null,
    refetchInterval: run === null ? false : 2000,
  });
  const processRecord = processList.data?.find(
    (record) => record.ref?.type === 'orchestration_run' && record.ref.id === run?.id,
  );
  useNotification('orch.event', (event) => {
    if (event.type === 'run' && event.run.projectId === projectId) setRun(event.run);
    else if (run !== null && event.type !== 'run' && event.runId === run.id) {
      void rpc
        .call('orch.get', { runId: run.id })
        .then(setRun)
        .catch(() => undefined);
    }
  });
  useEffect(() => {
    if (intent?.kind !== 'orchestrationRun' || list.data === undefined) return;
    const found = list.data.find((item) => item.id === intent.id);
    if (found !== undefined)
      startTransition(() => {
        setRun(found);
      });
    clearIntent();
  }, [clearIntent, intent, list.data]);
  useEffect(() => {
    if (run === null) return;
    const startedAt = Date.parse(run.createdAt);
    const timer = window.setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAt));
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [run]);
  const adaptersReady = (adapters.data ?? []).some((item) => item.transport === 'api' && item.status === 'available');
  const selectedRoles = roles.data?.orchestration.roles;
  const rolesReady =
    selectedRoles !== undefined &&
    [selectedRoles.supervisor, selectedRoles.workerA, selectedRoles.workerB, selectedRoles.reviewer].every((agent) =>
      adapters.data?.some((adapter) => adapter.transport === agent.transport && adapter.status === 'available'),
    );
  const disabled = projectId === null || !adaptersReady || !rolesReady;
  async function action(
    method: 'orch.plan' | 'orch.start' | 'orch.cancel' | 'orch.resume' | 'orch.approve' | 'orch.discard',
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      let result: OrchRun;
      if (method === 'orch.plan') {
        if (projectId === null) return;
        result = await rpc.call(method, { projectId, request });
      } else {
        if (run === null) return;
        result = await rpc.call(method, { runId: run.id });
      }
      setRun(result);
      if (method === 'orch.plan') await list.refetch();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('code.actionError'));
    } finally {
      setBusy(false);
    }
  }
  const elapsed = Math.floor(elapsedMs / 60_000);
  const unknown = t('code.orchestrationUnknown');
  return (
    <section className="space-y-5" aria-labelledby="orch-code-heading">
      <PageHeader
        icon="studio"
        title={t('code.orchestration')}
        subtitle={t('code.orchestrationDescription')}
        id="orch-code-heading"
        level={2}
      />
      {disabled ? (
        <p className="rounded border border-border p-3 text-text-muted" role="status">
          {t(projectId === null ? 'code.orchestrationPickProject' : 'code.orchestrationDisabled')}
        </p>
      ) : null}
      <label className="block">
        {t('code.orchestrationRequest')}
        <textarea
          className="mt-1 block min-h-28 w-full rounded border border-border bg-surface px-3 py-2"
          value={request}
          disabled={disabled || busy}
          onChange={(event) => {
            setRequest(event.target.value);
          }}
        />
      </label>
      <button
        className="rounded border border-border px-3 py-2 disabled:opacity-50"
        disabled={disabled || busy || request.trim().length === 0}
        onClick={() => {
          void action('orch.plan');
        }}
        type="button"
      >
        {busy ? t('code.orchestrationPlanning') : t('code.orchestrationPlan')}
      </button>
      {error ? (
        <p className="text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {run ? (
        <div className="space-y-4 rounded border border-border p-4">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">
                {t('code.orchestrationRun')}: {t(`code.orchestrationStates.${run.state}`)}
              </h3>
              <p>
                {t('code.orchestrationCost')}: {run.costMicroUsd / 1_000_000} / {run.limits.maxCostMicroUsd / 1_000_000}{' '}
                USD · {t('code.orchestrationCalls')}: {run.agentCalls} / {run.limits.maxAgentCalls} ·{' '}
                {t('code.orchestrationElapsed')}: {elapsed} / {Math.floor(run.limits.maxWallClockMs / 60_000)} min
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {run.state === OrchRunState.PLAN_READY ? (
                <button
                  className="rounded border border-border px-3 py-2"
                  disabled={busy}
                  onClick={() => {
                    void action('orch.start');
                  }}
                  type="button"
                >
                  {t('code.orchestrationStart')}
                </button>
              ) : null}
              {activeStates.includes(run.state) ? (
                <button
                  className="rounded border border-border px-3 py-2"
                  disabled={busy}
                  onClick={() => {
                    void action(
                      run.state === OrchRunState.PAUSED || run.state === OrchRunState.PAUSED_INTERRUPTED
                        ? 'orch.resume'
                        : 'orch.cancel',
                    );
                  }}
                  type="button"
                >
                  {t(
                    run.state === OrchRunState.PAUSED || run.state === OrchRunState.PAUSED_INTERRUPTED
                      ? 'code.orchestrationResume'
                      : 'code.orchestrationCancel',
                  )}
                </button>
              ) : null}
              {run.state === OrchRunState.AWAITING_APPROVAL ? (
                <>
                  <button
                    className="rounded border border-primary px-3 py-2"
                    disabled={busy}
                    onClick={() => {
                      void action('orch.approve');
                    }}
                    type="button"
                  >
                    {t('code.orchestrationApprove')}
                  </button>
                  <button
                    className="rounded border border-danger px-3 py-2"
                    disabled={busy}
                    onClick={() => {
                      void action('orch.discard');
                    }}
                    type="button"
                  >
                    {t('code.orchestrationDiscard')}
                  </button>
                </>
              ) : null}
            </div>
          </header>
          {run.state === OrchRunState.PAUSED ? (
            <div className="flex flex-wrap items-center gap-3 rounded border border-warning p-3" role="status">
              <span>{run.stateReason ?? t('code.orchestrationPaused')}</span>
              <a className="text-primary underline" href="#settings-orchestration">
                {t('code.orchestrationRaiseLimit')}
              </a>
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    'title',
                    'state',
                    'dependsOn',
                    'allowedPaths',
                    'candidateAgents',
                    'estimate',
                    'assigned',
                    'fixRounds',
                  ].map((key) => (
                    <th className="p-2" key={key}>
                      {t(`code.orchestrationColumns.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {run.tasks.map((task) => (
                  <tr className="border-t border-border" key={task.id}>
                    <th scope="row" className="p-2">
                      {task.title}
                      <small className="block text-text-muted">{task.id}</small>
                    </th>
                    <td className="p-2">
                      {t(`code.orchestrationStates.${task.state}`)}
                      {task.stateReason ? ` · ${task.stateReason}` : ''}
                    </td>
                    <td className="p-2">{task.dependsOn.join(', ') || '—'}</td>
                    <td className="p-2">{task.allowedPaths.join(', ')}</td>
                    <td className="p-2">{task.candidateAgents.join(', ')}</td>
                    <td className="p-2">{task.estimate}</td>
                    <td className="p-2">
                      {run.agents.find((agent) => agent.agentId === task.assignedAgentId)?.agentId ?? unknown}
                    </td>
                    <td className="p-2">{task.fixRounds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="space-y-2">
            <h4 className="font-semibold">{t('code.orchestrationAttempts')}</h4>
            {(attempts.data ?? []).map((attempt) => (
              <article className="rounded border border-border p-3" key={attempt.id}>
                <p>
                  {t(`code.orchestrationRoles.${attempt.role}`)}: {attempt.agent.agentId} ·{' '}
                  {attempt.agent.modelId ?? unknown} ·{' '}
                  {t(`settings.orchestration.transportNames.${attempt.agent.transport}`)}
                </p>
                <p>
                  {t('code.orchestrationDuration')}:{' '}
                  {attempt.endedAt
                    ? `${String(Math.max(0, Math.round((Date.parse(attempt.endedAt) - Date.parse(attempt.startedAt)) / 1000)))} s`
                    : unknown}{' '}
                  · {t('code.orchestrationUsage')}: {attempt.usage.inputTokens ?? unknown} /{' '}
                  {attempt.usage.outputTokens ?? unknown} ·{' '}
                  {attempt.usage.costMicroUsd === null
                    ? unknown
                    : `${String(attempt.usage.costMicroUsd / 1_000_000)} USD`}
                </p>
                <p>
                  {t('code.orchestrationWorktree')}: {attempt.worktree ?? unknown} · {t('code.orchestrationBase')}:{' '}
                  {attempt.baseSha ?? unknown} · {t('code.orchestrationHead')}: {attempt.headSha ?? unknown} ·{' '}
                  {attempt.reason ?? unknown}
                </p>
                <ul className="list-disc pl-5">
                  {attempt.changedFiles.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                  {attempt.evidence.map((item) => (
                    <li key={item.id}>
                      {item.spec.executable} {item.spec.args.join(' ')}:{' '}
                      {item.exitCode === 0 ? t('code.passed') : t('code.failed')}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>
        </div>
      ) : null}
      {processRecord !== undefined ? (
        <ProcessGraph
          record={processRecord}
          packets={[]}
          onSelect={() => undefined}
          fitRevision={0}
          onCanvasClick={() => undefined}
        />
      ) : null}
      <ul className="space-y-1">
        {(list.data ?? [])
          .filter((item) => item.id !== run?.id)
          .map((item) => (
            <li key={item.id}>
              <button
                className="text-primary underline"
                onClick={() => {
                  setRun(item);
                }}
                type="button"
              >
                {item.request} · {item.state}
              </button>
            </li>
          ))}
      </ul>
    </section>
  );
}
