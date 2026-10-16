import type { ProcessEvent, ProcessId, ProcessRecord, ProjectId } from '@itstudio/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
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

export const PROCESS_QUERY_KEY = ['process.list', { limit: 100 }] as const;

/** All consumers share one snapshot; project filters are views of that snapshot. */
export function useProcesses(projectId?: ProjectId) {
  const rpc = useRpcClient();
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: PROCESS_QUERY_KEY,
    queryFn: async () => {
      const pending = new Map<ProcessId, ProcessEvent>();
      const unsubscribe = rpc.on('process.event', (event) => {
        pending.set(event.type === 'upsert' ? event.process.id : event.id, event);
      });
      try {
        const records = await rpc.call('process.list', { limit: 100 });
        return [...pending.values()].reduce(applyProcessEvent, retainProcesses(records));
      } finally {
        unsubscribe();
      }
    },
  });
  useEffect(
    () =>
      rpc.on('process.event', (event) => {
        cache.setQueryData<readonly ProcessRecord[]>(PROCESS_QUERY_KEY, (current) =>
          applyProcessEvent(current ?? [], event),
        );
      }),
    [rpc, cache],
  );
  const applyChange = async (event: ProcessEvent): Promise<void> => {
    await cache.cancelQueries({ queryKey: PROCESS_QUERY_KEY });
    cache.setQueryData<readonly ProcessRecord[]>(PROCESS_QUERY_KEY, (current) =>
      applyProcessEvent(current ?? [], event),
    );
  };
  return {
    ...query,
    records: (query.data ?? []).filter((record) => projectId === undefined || record.projectId === projectId),
    applyChange,
  };
}
