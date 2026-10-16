import {
  WorkflowModuleId,
  type ActivityEvent,
  type ActivityKind,
  type ProjectId,
  type WorkflowEdge,
  type WorkflowNode,
  type ProcessKind,
} from '@itstudio/schemas';
import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Money } from '../../components/Money';
import { mergeActivity, openActivity } from './activity';

type PanelTab = 'now' | 'recent' | 'metrics' | 'links' | 'deepLinks';
const kinds: readonly (ActivityKind | 'all')[] = ['all', 'started', 'progress', 'completed', 'failed', 'info'];

export function ModulePanel({
  node,
  edges,
  liveEvents,
  recentEvents,
  loadingMore,
  canLoadMore,
  projectId,
  projects,
  onLoadMore,
  onClose,
  onNavigate,
  onShowProcesses,
}: {
  readonly node: WorkflowNode;
  readonly edges: readonly WorkflowEdge[];
  readonly liveEvents: readonly ActivityEvent[];
  readonly recentEvents: readonly ActivityEvent[];
  readonly loadingMore: boolean;
  readonly canLoadMore: boolean;
  readonly projectId: ProjectId | null;
  readonly projects: readonly { readonly id: ProjectId; readonly name: string }[];
  readonly onLoadMore: () => void;
  readonly onClose: () => void;
  readonly onNavigate: (route: 'chat' | 'code' | 'knowledge' | 'cost', event?: ActivityEvent) => void;
  readonly onShowProcesses?: (kind: ProcessKind) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<PanelTab>('now');
  const [kind, setKind] = useState<ActivityKind | 'all'>('all');
  const [projectFilter, setProjectFilter] = useState<ProjectId | 'all'>('all');
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  const events = useMemo(() => mergeActivity([...liveEvents, ...recentEvents]), [liveEvents, recentEvents]);
  const filtered = events.filter(
    (event) =>
      (kind === 'all' || event.kind === kind) && (projectFilter === 'all' || event.projectId === projectFilter),
  );
  const nowEvents = openActivity(events).filter(
    (event) => projectFilter === 'all' || event.projectId === projectFilter,
  );
  const durations = events
    .map((event) => event.durationMs)
    .filter((duration): duration is number => duration !== undefined)
    .sort((a, b) => a - b);
  const percentile = (fraction: number): number | undefined =>
    durations.length === 0 ? undefined : durations[Math.ceil(durations.length * fraction) - 1];
  const lastEvent = (edge: WorkflowEdge) => events.find((event) => event.edgeId === edge.id);
  const linksIn = edges.filter((edge) => edge.to === node.id);
  const linksOut = edges.filter((edge) => edge.from === node.id);
  const navTarget = (event: ActivityEvent): 'chat' | 'code' | 'knowledge' | 'cost' | undefined =>
    event.moduleId === WorkflowModuleId.LEDGER &&
    (event.refs.requestId !== undefined || event.refs.pipelineRunId !== undefined)
      ? 'cost'
      : event.refs.conversationId !== undefined || event.refs.requestId !== undefined
        ? 'chat'
        : event.refs.pipelineRunId !== undefined
          ? 'code'
          : event.refs.ingestJobId !== undefined
            ? 'knowledge'
            : event.refs.ledgerEntryId !== undefined
              ? 'cost'
              : undefined;
  const open = (event: ActivityEvent): void => {
    const target = navTarget(event);
    if (target !== undefined) onNavigate(target, event);
  };
  const processKind: ProcessKind | undefined =
    node.id === WorkflowModuleId.CHAT
      ? 'chat'
      : node.id === WorkflowModuleId.CODE ||
          node.id === WorkflowModuleId.PIPELINE_PM ||
          node.id === WorkflowModuleId.PIPELINE_CODER ||
          node.id === WorkflowModuleId.PIPELINE_REVIEWER ||
          node.id === WorkflowModuleId.WORKER
        ? 'code_pipeline'
        : node.id === WorkflowModuleId.KNOWLEDGE ||
            node.id === WorkflowModuleId.RAG_INGEST ||
            node.id === WorkflowModuleId.EMBEDDINGS ||
            node.id === WorkflowModuleId.VECTOR_STORE ||
            node.id === WorkflowModuleId.RETRIEVER
          ? 'knowledge_ingest'
          : node.id === WorkflowModuleId.PRICING_FX
            ? 'price_update'
            : node.id === WorkflowModuleId.VSCODE_BRIDGE
              ? 'vscode_launch'
              : undefined;

  return (
    <aside
      aria-label={t(node.labelKey)}
      className="flex min-h-[520px] flex-col gap-4 overflow-auto rounded-lg border border-border bg-surface p-4"
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t(node.labelKey)}</h2>
          <p className="text-sm text-text-muted">{t(`workflow.status.${node.status}`)}</p>
        </div>
        <button
          aria-label={t('workflow.closePanel')}
          className="rounded px-2 py-1 hover:bg-surface-alt"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {processKind !== undefined && onShowProcesses !== undefined ? (
        <button
          className="self-start rounded border border-border px-3 py-2"
          onClick={() => {
            onShowProcesses(processKind);
          }}
        >
          {t('workflow.showProcesses')}
        </button>
      ) : null}
      {projectId === null ? (
        <fieldset className="space-y-1">
          <legend className="text-sm">{t('workflow.projectFilter')}</legend>
          <div className="flex flex-wrap gap-1">
            <button
              aria-pressed={projectFilter === 'all'}
              className="rounded-full border border-border px-3 py-1 text-sm aria-pressed:bg-surface-alt"
              onClick={() => {
                setProjectFilter('all');
              }}
            >
              {t('workflow.allProjects')}
            </button>
            {projects.map((project) => (
              <button
                aria-pressed={projectFilter === project.id}
                className="rounded-full border border-border px-3 py-1 text-sm aria-pressed:bg-surface-alt"
                key={project.id}
                onClick={() => {
                  setProjectFilter(project.id);
                }}
              >
                {project.name}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div aria-label={t('workflow.panelTabs')} className="flex flex-wrap gap-1" role="tablist">
        {(['now', 'recent', 'metrics', 'links', 'deepLinks'] as const).map((key) => (
          <button
            aria-selected={tab === key}
            className="rounded border border-border px-2 py-1 text-sm aria-selected:bg-surface-alt"
            key={key}
            onClick={() => {
              setTab(key);
            }}
            role="tab"
          >
            {t(`workflow.tabs.${key}`)}
          </button>
        ))}
      </div>
      {tab === 'now' ? (
        <section aria-label={t('workflow.tabs.now')} className="space-y-2" role="tabpanel">
          <p>
            {t('workflow.inFlight')}: {node.inFlight}
          </p>
          {nowEvents.map((event) => (
            <article className="rounded border border-border p-2 text-sm" key={event.id}>
              <p>{event.summary}</p>
              <time dateTime={event.ts}>
                {t('workflow.elapsed', {
                  seconds: now === 0 ? 0 : Math.max(0, Math.floor((now - Date.parse(event.ts)) / 1000)),
                })}
              </time>
            </article>
          ))}
          {nowEvents.length === 0 ? <p className="text-text-muted">{t('workflow.noneNow')}</p> : null}
        </section>
      ) : null}
      {tab === 'recent' ? (
        <section aria-label={t('workflow.tabs.recent')} className="space-y-2" role="tabpanel">
          <label className="text-sm">
            {t('workflow.kindFilter')}
            <select
              aria-label={t('workflow.kindFilter')}
              className="ml-2 rounded border border-border bg-bg p-1"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as ActivityKind | 'all');
              }}
            >
              {kinds.map((value) => (
                <option key={value} value={value}>
                  {t(value === 'all' ? 'workflow.all' : `workflow.kinds.${value}`)}
                </option>
              ))}
            </select>
          </label>
          {filtered.map((event) => (
            <article className="rounded border border-border p-2 text-sm" key={event.id}>
              <p>{event.summary}</p>
              <div className="text-text-muted">
                {t(`workflow.kinds.${event.kind}`)} · <time dateTime={event.ts}>{event.ts}</time>
              </div>
              {navTarget(event) === undefined ? null : (
                <button
                  className="mt-1 underline"
                  onClick={() => {
                    open(event);
                  }}
                >
                  {t('workflow.openLink')}
                </button>
              )}
            </article>
          ))}
          <button
            className="rounded border border-border px-3 py-1 disabled:opacity-50"
            disabled={!canLoadMore || loadingMore}
            onClick={() => {
              onLoadMore();
            }}
          >
            {loadingMore ? t('workflow.loading') : t('workflow.loadMore')}
          </button>
        </section>
      ) : null}
      {tab === 'metrics' ? (
        <section aria-label={t('workflow.tabs.metrics')} className="space-y-2" role="tabpanel">
          <p>
            {t('workflow.calls')}: {node.calls24h}
          </p>
          <p>
            {t('workflow.errors')}: {node.errors24h}
          </p>
          <p>
            {t('workflow.p50')}: {percentile(0.5) ?? '—'} ms
          </p>
          <p>
            {t('workflow.p95')}: {percentile(0.95) ?? '—'} ms
          </p>
          <p>
            {t('workflow.cost')}: {node.cost24h === undefined ? '—' : <Money compact value={node.cost24h} />}
          </p>
        </section>
      ) : null}
      {tab === 'links' ? (
        <section aria-label={t('workflow.tabs.links')} className="space-y-3" role="tabpanel">
          {[...linksIn, ...linksOut].map((edge) => (
            <article className="rounded border border-border p-2 text-sm" key={edge.id}>
              <p>
                {edge.from} → {edge.to}
              </p>
              <p>{edge.contract}</p>
              <p className="text-text-muted">{lastEvent(edge)?.summary ?? t('workflow.noSummary')}</p>
            </article>
          ))}
          {linksIn.length + linksOut.length === 0 ? <p>{t('workflow.noLinks')}</p> : null}
        </section>
      ) : null}
      {tab === 'deepLinks' ? (
        <section aria-label={t('workflow.tabs.deepLinks')} className="space-y-2" role="tabpanel">
          {(['chat', 'code', 'knowledge', 'cost'] as const).map((target) => (
            <button
              className="block underline"
              key={target}
              onClick={() => {
                onNavigate(target);
              }}
            >
              {t(`workflow.open.${target}`)}
            </button>
          ))}
        </section>
      ) : null}
    </aside>
  );
}
