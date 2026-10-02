import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { connectSidecarStatus } from './state/sidecar-store';
import { RpcClient } from './rpc/rpc-client';
import { RpcClientProvider } from './rpc/rpc-context';
import { TauriTransport } from './rpc/transport';
import './index.css';
import './i18n';

const transport = new TauriTransport();
const rpcClient = new RpcClient(transport);
const queryClient = new QueryClient();
connectSidecarStatus(transport);

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Root element is missing');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider client={rpcClient}>
        <App />
      </RpcClientProvider>
    </QueryClientProvider>
  </StrictMode>,
);
