import type { PipelineEvent, PipelineRun, ProcessRecord } from '@itstudio/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';
import { pipelineModules } from '../../../../sidecar/src/domain/pipeline-process';
import { pipeline } from './test-fixtures';

let canvasWidth = 1280;
let canvasHeight = 800;
class TestResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  public observe(target: Element): void {
    const isNode = target.matches('.react-flow__node');
    const width = isNode ? 210 : canvasWidth;
    const height = isNode ? 88 : canvasHeight;
    Object.defineProperty(target, 'offsetWidth', { configurable: true, value: width });
    Object.defineProperty(target, 'offsetHeight', { configurable: true, value: height });
    this.callback(
      [
        {
          target,
          contentRect: new DOMRect(0, 0, width, height),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      this,
    );
  }
  public unobserve(): void {
    /* Synchronous observer fixture owns no subscription. */
  }
  public disconnect(): void {
    /* Synchronous observer fixture owns no subscription. */
  }
}
export function graphDimensions(width = 1280, height = 800): void {
  canvasWidth = width;
  canvasHeight = height;
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      public readonly m22 = 1;
    },
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
export function mountStudio(ui: ReactNode, initialRuns: readonly PipelineRun[] = [pipeline()]) {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  let runs = initialRuns;
  let errorMethod: string | null = null;
  const processRecords = (): readonly ProcessRecord[] =>
    runs.map((run): ProcessRecord => ({
      // @ts-expect-error Readable fixture identifier stands in for a sidecar process ID.
      id: 'process-' + run.id,
      projectId: run.projectId,
      kind: 'code_pipeline',
      title: run.prompt,
      status:
        run.stage === 'completed'
          ? 'ended'
          : ['failed', 'rolled_back', 'cancelled'].includes(run.stage)
            ? 'stopped'
            : run.stage === 'clarifying'
              ? 'waiting'
              : 'running',
      modules: pipelineModules(
        ['failed', 'rolled_back'].includes(run.stage) && run.failureReport === undefined
          ? {
              ...run,
              failureReport: {
                stage: 'validating',
                rolledBack: true,
                error: { code: 'INTERNAL', message: 'Failed', retryable: false },
                nextSteps: ['Retry'],
                logExcerpt: '',
              },
            }
          : run,
      ),
      edges: [],
      retryable: true,
      ref: { type: 'pipeline_run', id: run.id },
      createdAt: run.startedAt,
      updatedAt: run.startedAt,
    }));
  transport.send = (line) => {
    transport.sent.push(line);
    const request: unknown = JSON.parse(line);
    if (!isRecord(request) || typeof request.id !== 'number' || typeof request.method !== 'string')
      return Promise.resolve();
    const params = isRecord(request.params) ? request.params : {};
    let result: unknown = undefined;
    if (request.method === 'pipeline.list') result = runs;
    if (request.method === 'process.list') result = processRecords();
    if (request.method === 'pipeline.get') result = runs.find((run) => run.id === params.runId) ?? pipeline();
    if (request.method === 'pipeline.start') {
      const run = pipeline({
        // @ts-expect-error Readable fixture stands in for a branded run identifier.
        id: 'run-new',
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        // @ts-expect-error ISO fixture stands in for a branded timestamp.
        startedAt: '2026-01-02T00:00:00.000Z',
      });
      runs = [run, ...runs];
      result = run;
    }
    if (request.method === 'pipeline.answerClarifications') {
      const previous = runs.find((run) => run.id === params.runId) ?? pipeline();
      const run = {
        ...previous,
        stage: 'specifying' as const,
        clarifications:
          previous.clarifications?.map((q) => ({
            ...q,
            answer: { by: 'user' as const, optionId: q.recommendedOptionId, at: previous.startedAt },
          })) ?? [],
      };
      runs = runs.map((item) => (item.id === run.id ? run : item));
      result = run;
    }
    if (request.method === 'project.list')
      result = [
        {
          id: 'project-1',
          name: 'Project One',
          workspaceRoot: 'C:/project',
          archived: false,
          createdAt: pipeline().startedAt,
        },
      ];
    if (request.method === 'settings.get')
      result = { activeProjectId: 'project-1', ui: { themeId: 'arctic-focus', mode: 'system', locale: 'en' } };
    if (request.method === 'secrets.status') result = [];
    if (request.method === 'secrets.history') result = [];
    if (request.method === 'system.ping') result = { version: '0.1.0' };
    transport.receive(
      JSON.stringify(
        request.method === errorMethod
          ? {
              jsonrpc: '2.0',
              id: request.id,
              error: {
                code: -32603,
                message: 'Studio RPC failed',
                data: { code: 'INTERNAL', message: 'Studio RPC failed', retryable: true },
              },
            }
          : { jsonrpc: '2.0', id: request.id, result },
      ),
    );
    if (request.method.startsWith('pipeline.'))
      for (const process of processRecords())
        transport.receive(
          JSON.stringify({ jsonrpc: '2.0', method: 'process.event', params: { type: 'upsert', process } }),
        );
    return Promise.resolve();
  };
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = new RpcClient(transport);
  const view = render(
    <QueryClientProvider client={query}>
      <RpcClientProvider client={client}>{ui}</RpcClientProvider>
    </QueryClientProvider>,
  );
  return {
    ...view,
    transport,
    setRuns: (value: readonly PipelineRun[]): void => {
      runs = value;
    },
    fail: (method: string): void => {
      errorMethod = method;
    },
    notify: (event: PipelineEvent): void => {
      transport.receive(JSON.stringify({ jsonrpc: '2.0', method: 'pipeline.event', params: event }));
    },
    calls: (method: string): readonly string[] =>
      transport.sent.filter((line) => line.includes(`"method":"${method}"`)),
    dispose: (): void => {
      client.dispose();
      query.clear();
    },
  };
}
