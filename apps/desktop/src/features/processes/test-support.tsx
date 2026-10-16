import type { ProcessEvent, ProcessRecord } from '@itstudio/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';

export function processRecord(overrides: Partial<ProcessRecord> = {}): ProcessRecord {
  return {
    // @ts-expect-error Readable fixture represents a sidecar-generated process ID.
    id: 'process-chat',
    // @ts-expect-error Readable fixture represents a sidecar-generated project ID.
    projectId: 'project-1',
    kind: 'chat',
    title: 'Chat request',
    status: 'running',
    retryable: false,
    // @ts-expect-error Fixed ISO timestamp fixture.
    createdAt: '2026-10-16T01:00:00.000Z',
    // @ts-expect-error Fixed ISO timestamp fixture.
    updatedAt: '2026-10-16T01:00:00.000Z',
    modules: [
      { id: 'input', label: 'Input', state: 'done', input: 'Question summary', output: 'Accepted' },
      {
        id: 'router',
        label: 'Router',
        state: 'active',
        input: 'Route request',
        output: 'Model selected',
        detail: { model: 'example/model', tokens: 42 },
      },
      { id: 'output', label: 'Output', state: 'idle' },
    ],
    edges: [
      { from: 'input', to: 'router', label: 'Request' },
      { from: 'router', to: 'output' },
    ],
    ref: { type: 'conversation', id: 'conversation-1' },
    ...overrides,
  };
}
const requestSchema = z.object({ id: z.number(), method: z.string(), params: z.record(z.string(), z.unknown()) });
export function mountProcesses(ui: ReactNode, initial: readonly ProcessRecord[] = [processRecord()]) {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  let records = initial;
  let fail = '';
  const requests: z.infer<typeof requestSchema>[] = [];
  transport.send = (line) => {
    const request = requestSchema.parse(JSON.parse(line));
    requests.push(request);
    const { method, params, id } = request;
    let result: unknown = {};
    if (method === 'settings.get') result = { ui: { themeId: 'arctic-focus', mode: 'system' } };
    if (method === 'process.list')
      result = records.filter((record) => params.projectId === undefined || record.projectId === params.projectId);
    if (method === 'process.get') result = records.find((record) => record.id === params.id);
    if (['process.cancel', 'process.dismiss', 'process.retry'].includes(method)) {
      const record = records.find((item) => item.id === params.id);
      result = record;
      if (record !== undefined && method !== fail) {
        const updated: ProcessRecord = {
          ...record,
          // @ts-expect-error Readable identifier models the distinct process returned by retry.
          id: method === 'process.retry' ? record.id + '-retry' : record.id,
          status: method === 'process.cancel' ? 'stopped' : method === 'process.dismiss' ? 'ended' : 'running',
        };
        records =
          method === 'process.retry'
            ? [...records, updated]
            : records.map((item) => (item.id === record.id ? updated : item));
        result = updated;
      }
    }
    if (method === 'process.delete') {
      result = { deleted: records.some((record) => record.id === params.id) };
      if (method !== fail) records = records.filter((record) => record.id !== params.id);
    }
    if (method === fail)
      transport.receive(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32000,
            message: 'Unavailable',
            data: { code: 'INTERNAL', message: 'Unavailable', retryable: true },
          },
        }),
      );
    else transport.receive(JSON.stringify({ jsonrpc: '2.0', id, result }));
    return Promise.resolve();
  };
  const client = new RpcClient(transport);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={cache}>
      <RpcClientProvider client={client}>{ui}</RpcClientProvider>
    </QueryClientProvider>,
  );
  return {
    ...view,
    requests,
    client,
    cache,
    fail: (method: string) => {
      fail = method;
    },
    notify: (event: ProcessEvent) => {
      records =
        event.type === 'removed'
          ? records.filter((record) => record.id !== event.id)
          : [...records.filter((record) => record.id !== event.process.id), event.process];
      transport.receive(JSON.stringify({ jsonrpc: '2.0', method: 'process.event', params: event }));
    },
    dispose: () => {
      client.dispose();
      cache.clear();
    },
  };
}
