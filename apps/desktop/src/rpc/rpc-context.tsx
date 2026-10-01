import { createContext, type ReactNode, useContext } from 'react';
import type { RpcClient } from './rpc-client';

const RpcClientContext = createContext<RpcClient | null>(null);

export interface RpcClientProviderProps {
  readonly client: RpcClient;
  readonly children: ReactNode;
}

export function RpcClientProvider({ client, children }: RpcClientProviderProps) {
  return <RpcClientContext.Provider value={client}>{children}</RpcClientContext.Provider>;
}

export function useRpcClient(): RpcClient {
  const client = useContext(RpcClientContext);
  if (client === null) throw new Error('RPC hooks require an RpcClientProvider');
  return client;
}
