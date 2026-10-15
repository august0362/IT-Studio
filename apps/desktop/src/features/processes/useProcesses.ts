import type { ProcessEvent, ProcessId, ProcessRecord, ProjectId } from '@itstudio/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useRpcClient } from '../../rpc/rpc-context';

export function retainProcesses(records: readonly ProcessRecord[]): readonly ProcessRecord[] {
  let ended = 0;
  return [...records]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter((record) => record.status !== 'ended' || ++ended <= 20);
}

export function applyProcessEvent(records: readonly ProcessRecord[], event: ProcessEvent): readonly ProcessRecord[] {
  const id = event.type === 'upsert' ? event.process.id : event.id;
  const rest = records.filter((record) => record.id !== id);
  return retainProcesses(event.type === 'upsert' ? [...rest, event.process] : rest);
}

/** Subscribe before taking the snapshot; notifications received during the request win. */
export function useProcesses(projectId?: ProjectId) {
  const rpc = useRpcClient();
  const cache = useQueryClient();
  const events = useRef(new Map<ProcessId, ProcessEvent>());
  const params = projectId === undefined ? { limit: 100 } : { projectId, limit: 100 };
  const matchesProject = (records: readonly ProcessRecord[]): readonly ProcessRecord[] =>
    records.filter((record) => projectId === undefined || record.projectId === projectId);
  const query = useQuery({
    queryKey: ['process.list', params],
    queryFn: async () => {
      const records = await rpc.call('process.list', params);
      return matchesProject([...events.current.values()].reduce(applyProcessEvent, retainProcesses(records)));
    },
  });
  useEffect(
    () =>
      rpc.on('process.event', (event) => {
        events.current.set(event.type === 'upsert' ? event.process.id : event.id, event);
        const key = projectId === undefined ? { limit: 100 } : { projectId, limit: 100 };
        cache.setQueryData<readonly ProcessRecord[]>(['process.list', key], (current) =>
          applyProcessEvent(current ?? [], event).filter(
            (record) => projectId === undefined || record.projectId === projectId,
          ),
        );
      }),
    [rpc, cache, projectId],
  );
  const records = matchesProject([...events.current.values()].reduce(applyProcessEvent, query.data ?? []));
  return { ...query, records };
}
