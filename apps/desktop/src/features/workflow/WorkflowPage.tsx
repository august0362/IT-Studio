import type { ActivityEvent, ProjectId, WorkflowModuleId } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../../hooks/use-notification';
import { useRpcClient } from '../../rpc/rpc-context';
import { ModulePanel } from './ModulePanel';
import { WorkflowGraphProvider } from './WorkflowGraph';
import { initialWorkflowState, workflowReducer } from './workflow-store';

export function WorkflowPage({
  projectId,
  projects,
  onNavigate,
}: {
  readonly projectId: ProjectId | null;
  readonly projects: readonly { readonly id: ProjectId; readonly name: string }[];
  readonly onNavigate: (route: 'chat' | 'code' | 'knowledge' | 'cost', event?: ActivityEvent) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const [state, dispatch] = useReducer(workflowReducer, initialWorkflowState);
  const [selectedId, setSelectedId] = useState<WorkflowModuleId | null>(null);
  const [recent, setRecent] = useState<readonly ActivityEvent[]>([]);
  const [recentFor, setRecentFor] = useState<WorkflowModuleId | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const queued = useRef<ActivityEvent[]>([]);
  const frame = useRef<number | null>(null);

  const refreshGraph = useCallback(async () => {
    if (document.visibilityState === 'hidden') return;
    try {
      dispatch({ type: 'graph', graph: await rpc.call('workflow.graph', { projectId }) });
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [projectId, rpc]);

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      if (!disposed && document.visibilityState === 'visible') void refreshGraph();
    };
    const initialRefresh = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 30_000);
    const visibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      disposed = true;
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [refreshGraph]);

  const receive = useCallback(
    (batch: readonly ActivityEvent[]) => {
      queued.current.push(...batch.filter((event) => event.projectId === projectId || projectId === null));
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        dispatch({ type: 'activity', events: queued.current, now: Date.now() });
        queued.current = [];
      });
    },
    [projectId],
  );
  useNotification('workflow.activity', receive);
  useEffect(
    () => () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    },
    [],
  );
  useEffect(() => {
    const timer = window.setInterval(() => {
      dispatch({ type: 'expire', now: Date.now() });
    }, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const node = state.graph?.nodes.find((item) => item.id === selectedId);
  const liveEvents = useMemo(
    () => state.events.filter((event) => event.moduleId === selectedId),
    [selectedId, state.events],
  );
  useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;
    void rpc
      .call('workflow.activity', { projectId, moduleId: selectedId, limit: 50 })
      .then((events) => {
        if (!cancelled) {
          setRecent(events);
          setRecentFor(selectedId);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, rpc, selectedId]);

  const selectedRecent = useMemo(() => (recentFor === selectedId ? recent : []), [recentFor, recent, selectedId]);
  const loadMore = useCallback(async () => {
    if (selectedId === null || loadingMore || selectedRecent.length === 0) return;
    setLoadingMore(true);
    try {
      const before = selectedRecent[selectedRecent.length - 1]?.ts;
      if (before === undefined) return;
      const page = await rpc.call('workflow.activity', { projectId, moduleId: selectedId, limit: 50, before });
      setRecent((current) => [...current, ...page.filter((event) => !current.some((item) => item.id === event.id))]);
    } catch {
      setLoadError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, projectId, rpc, selectedId, selectedRecent]);

  return (
    <section aria-label={t('workflow.heading')} className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('workflow.heading')}</h1>
        <button
          className="rounded border border-border px-3 py-1"
          onClick={() => {
            void refreshGraph();
          }}
        >
          {t('workflow.refresh')}
        </button>
      </div>
      {loadError ? (
        <p role="alert" className="text-danger">
          {t('workflow.loadError')}
        </p>
      ) : null}
      {state.graph === null ? (
        <p role="status">{t('workflow.loading')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <WorkflowGraphProvider
            activeEdges={state.activeEdges}
            edges={state.graph.edges}
            nodes={state.graph.nodes}
            onSelect={setSelectedId}
            pulses={state.pulses}
          />
          {node === undefined ? (
            <div
              aria-label={t('workflow.selectModule')}
              className="rounded-lg border border-border p-4 text-text-muted"
            >
              {t('workflow.selectModule')}
            </div>
          ) : (
            <ModulePanel
              canLoadMore={selectedRecent.length < 20_000 && selectedRecent.length > 0}
              edges={state.graph.edges}
              liveEvents={liveEvents}
              loadingMore={loadingMore}
              node={node}
              onLoadMore={() => {
                void loadMore();
              }}
              onClose={() => {
                setSelectedId(null);
              }}
              onNavigate={onNavigate}
              projectId={projectId}
              projects={projects}
              recentEvents={selectedRecent}
            />
          )}
        </div>
      )}
    </section>
  );
}
