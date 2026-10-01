import { useMutation } from '@tanstack/react-query';
import type { RpcMethod, RpcMethodMap } from '@itstudio/schemas';
import type { RpcCallError } from '../rpc/rpc-client';
import { useRpcClient } from '../rpc/rpc-context';

export function useRpcMutation<M extends RpcMethod>(method: M) {
  const rpc = useRpcClient();
  return useMutation<RpcMethodMap[M]['result'], RpcCallError, RpcMethodMap[M]['params']>({
    mutationFn: (params) => rpc.call(method, params),
  });
}
