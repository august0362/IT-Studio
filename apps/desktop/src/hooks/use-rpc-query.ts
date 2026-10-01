import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { RpcMethod, RpcMethodMap } from '@itstudio/schemas';
import type { RpcCallError } from '../rpc/rpc-client';
import { useRpcClient } from '../rpc/rpc-context';

export type RpcQueryOptions<M extends RpcMethod> = Omit<
  UseQueryOptions<RpcMethodMap[M]['result'], RpcCallError>,
  'queryKey' | 'queryFn'
>;

export function useRpcQuery<M extends RpcMethod>(
  method: M,
  params: RpcMethodMap[M]['params'],
  options?: RpcQueryOptions<M>,
) {
  const rpc = useRpcClient();
  return useQuery({
    queryKey: [method, params],
    queryFn: () => rpc.call(method, params),
    ...options,
  });
}
