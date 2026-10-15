import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNotification } from '../../hooks/use-notification';
import { useRpcClient } from '../../rpc/rpc-context';
import type { RichProcessPanelProps } from '../processes/ProcessViewer';
import type { CommandOutputState } from '../code/pipeline-store';
import { MODULES } from './studio-model';
import { StudioPanel } from './StudioPanel';

export function ProcessCodePanel({ record, module, onClose, children }: RichProcessPanelProps) {
  const rpc = useRpcClient();
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<Readonly<Record<string, CommandOutputState>>>({});
  const history = useQuery({
    queryKey: ['pipeline.list', { projectId: record.projectId, limit: 100 }],
    queryFn: () =>
      record.projectId === undefined
        ? Promise.resolve([])
        : rpc.call('pipeline.list', { projectId: record.projectId, limit: 100 }),
    enabled: record.projectId !== undefined,
  });
  const run = history.data?.find((item) => item.id === record.ref?.id);
  const detail = useQuery({
    queryKey: ['pipeline.get', { runId: run?.id }],
    queryFn: () => (run === undefined ? Promise.resolve(null) : rpc.call('pipeline.get', { runId: run.id })),
    enabled: run !== undefined,
  });
  useNotification('pipeline.event', (event) => {
    if (event.runId !== record.ref?.id) return;
    if (event.type === 'command_output')
      setOutputs((current) => {
        const previous = current[event.commandRunId] ?? { stdout: '', stderr: '', truncated: false };
        return {
          ...current,
          [event.commandRunId]: {
            ...previous,
            [event.stream]: `${previous[event.stream]}${event.chunk}`.slice(-64000),
          },
        };
      });
    void cache.invalidateQueries({ queryKey: ['pipeline.get'] });
    void history.refetch();
  });
  const id = module.id === 're_review' ? 're-review' : module.id;
  const studioModule = MODULES.find((item) => item === id);
  if (studioModule === undefined) return null;
  return (
    <StudioPanel
      module={studioModule}
      status={module.state}
      run={detail.data ?? run}
      outputs={outputs}
      busy={busy}
      onClose={onClose}
      onAnswer={(answers) => {
        if (run === undefined) return;
        setBusy(true);
        setError(null);
        void rpc
          .call('pipeline.answerClarifications', { runId: run.id, answers })
          .then(() => cache.invalidateQueries({ queryKey: ['pipeline.get'] }))
          .catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : 'Unable to save answers.');
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      {children}
      {error || history.error || detail.error ? (
        <p role="alert">{error ?? history.error?.message ?? detail.error?.message}</p>
      ) : null}
    </StudioPanel>
  );
}
