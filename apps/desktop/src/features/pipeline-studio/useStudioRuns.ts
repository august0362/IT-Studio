import type { PipelineRun, PipelineRunId, PipelineStage, ProjectId, RpcMethodMap } from '@itstudio/schemas';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../../hooks/use-notification';
import { useRpcClient } from '../../rpc/rpc-context';
import type { CommandOutputState } from '../code/pipeline-store';
import { isFinished } from './studio-model';

export function useStudioRuns(projectId: ProjectId | null) {
  const rpc = useRpcClient();
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<Readonly<Record<string, PipelineRun>>>({});
  const [selectedId, setSelectedId] = useState<PipelineRunId | null>(null);
  const [entered, setEntered] = useState<Readonly<Record<string, readonly PipelineStage[]>>>({});
  const [outputs, setOutputs] = useState<Readonly<Record<string, Readonly<Record<string, CommandOutputState>>>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const revisions = useRef(new Map<PipelineRunId, number>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const fail = useCallback(
    (cause: unknown): void => {
      if (alive.current) setError(cause instanceof Error ? cause.message : t('pipelineStudio.rpcError'));
    },
    [t],
  );
  const history = useQuery({
    queryKey: ['pipeline.list', { projectId, limit: 20 }],
    queryFn: () => (projectId === null ? Promise.resolve([]) : rpc.call('pipeline.list', { projectId, limit: 20 })),
    enabled: projectId !== null,
  });
  const runs = useMemo(() => {
    const map = new Map((history.data ?? []).map((run) => [run.id, run]));
    for (const run of Object.values(loaded)) map.set(run.id, run);
    return [...map.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, 20);
  }, [history.data, loaded]);
  const newest = runs[0]?.id;
  const previousNewest = useRef<PipelineRunId | undefined>(undefined);
  useEffect(() => {
    if (newest !== undefined && newest !== previousNewest.current) setSelectedId(newest);
    previousNewest.current = newest;
  }, [newest]);
  const selected = runs.find((run) => run.id === selectedId) ?? runs[0];
  const load = useCallback(
    async (runId: PipelineRunId): Promise<void> => {
      const revision = (revisions.current.get(runId) ?? 0) + 1;
      revisions.current.set(runId, revision);
      try {
        const run = await rpc.call('pipeline.get', { runId });
        if (alive.current && run.projectId === projectId && revisions.current.get(runId) === revision)
          setLoaded((current) => ({ ...current, [run.id]: run }));
      } catch (cause: unknown) {
        fail(cause);
      }
    },
    [rpc, projectId, fail],
  );
  useEffect(() => {
    if (selectedId !== null) void load(selectedId);
  }, [selectedId, load]);
  useNotification('pipeline.event', (event) => {
    if (event.type === 'stage' || event.type === 'finished') {
      setLoaded((current) => {
        const run = current[event.runId] ?? runs.find((item) => item.id === event.runId);
        return run === undefined ? current : { ...current, [event.runId]: { ...run, stage: event.stage } };
      });
    }
    if (event.type === 'stage')
      setEntered((current) => ({ ...current, [event.runId]: [...(current[event.runId] ?? []), event.stage] }));
    if (event.type === 'command_output')
      setOutputs((current) => {
        const runOutputs = current[event.runId] ?? {};
        const previous = runOutputs[event.commandRunId] ?? { stdout: '', stderr: '', truncated: false };
        const lines = `${previous[event.stream]}${event.chunk}`.split('\n');
        return {
          ...current,
          [event.runId]: {
            ...runOutputs,
            [event.commandRunId]: {
              ...previous,
              [event.stream]: lines.slice(-2000).join('\n'),
              truncated: previous.truncated || lines.length > 2000,
            },
          },
        };
      });
    void load(event.runId);
    void history.refetch();
  });
  useNotification('pipeline.failureReport', (report) => {
    const id = report.runId;
    if (id === undefined) return;
    setLoaded((current) => {
      const run = current[id] ?? runs.find((item) => item.id === id);
      return run === undefined ? current : { ...current, [id]: { ...run, failureReport: report } };
    });
    void load(id);
  });
  async function start(prompt: string): Promise<boolean> {
    if (projectId === null) return false;
    setBusy(true);
    setError(null);
    try {
      const run = await rpc.call('pipeline.start', { projectId, prompt });
      if (!alive.current) return false;
      setLoaded((current) => ({ ...current, [run.id]: current[run.id] ?? run }));
      setSelectedId(run.id);
      void history.refetch();
      return true;
    } catch (cause: unknown) {
      fail(cause);
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function answer(answers: RpcMethodMap['pipeline.answerClarifications']['params']['answers']): Promise<void> {
    if (selected === undefined || busy) return;
    setBusy(true);
    setError(null);
    const revision = (revisions.current.get(selected.id) ?? 0) + 1;
    revisions.current.set(selected.id, revision);
    try {
      const run = await rpc.call('pipeline.answerClarifications', { runId: selected.id, answers });
      if (alive.current && revisions.current.get(run.id) === revision)
        setLoaded((current) => ({ ...current, [run.id]: run }));
    } catch (cause: unknown) {
      fail(cause);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const queued =
    selected?.stage === 'specifying' &&
    selected.spec === undefined &&
    !(entered[selected.id] ?? []).some((stage) => stage !== 'specifying') &&
    runs.some(
      (run) =>
        run.id !== selected.id && !isFinished(run) && Date.parse(run.startedAt) <= Date.parse(selected.startedAt),
    );
  return {
    runs,
    selected,
    select: setSelectedId,
    entered: selected === undefined ? [] : (entered[selected.id] ?? []),
    outputs: selected === undefined ? {} : (outputs[selected.id] ?? {}),
    queued,
    busy,
    start,
    answer,
    error: error ?? (history.error === null ? null : t('pipelineStudio.rpcError')),
    loading: history.isLoading,
  };
}
