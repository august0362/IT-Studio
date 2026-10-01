import { useEffect, useRef } from 'react';
import type { RpcNotificationMap, RpcNotificationName } from '@itstudio/schemas';
import { useRpcClient } from '../rpc/rpc-context';

export function useNotification<N extends RpcNotificationName>(
  name: N,
  handler: (payload: RpcNotificationMap[N]) => void,
): void {
  const rpc = useRpcClient();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => rpc.on(name, (payload) => {
    handlerRef.current(payload);
  }), [name, rpc]);
}
