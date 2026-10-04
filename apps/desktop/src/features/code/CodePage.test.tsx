import { PipelineStage, type PipelineRun } from '@itstudio/schemas';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { RpcClient } from '../../rpc/rpc-client';
import { RpcClientProvider } from '../../rpc/rpc-context';
import { FakeTransport } from '../../rpc/transport';
import { CodePage } from './CodePage';
import { useNavigationIntent } from '../../state/navigation-intent';

vi.mock('./monaco-setup', () => ({}));
vi.mock('@monaco-editor/react', () => ({ Editor: () => null, DiffEditor: () => null }));

afterEach(() => {
  cleanup();
  useNavigationIntent.getState().clearIntent();
  vi.restoreAllMocks();
  void i18n.changeLanguage('en');
});

function pipeline(stage: PipelineRun['stage']): PipelineRun {
  return {
    // @ts-expect-error Test fixture uses a readable placeholder branded run id.
    id: 'run-1',
    // @ts-expect-error Test fixture uses a readable placeholder branded project id.
    projectId: 'project-1',
    prompt: 'Build a sample',
    stage,
    roleAssignment: { pm: [], coder: [], reviewer: [] },
    coderOutputs: [],
    verdicts: [],
    fixAttempts: 0,
    cost: {
      // @ts-expect-error Test fixture uses an integer placeholder for branded money.
      microUsd: 0,
      // @ts-expect-error Test fixture uses an integer placeholder for branded money.
      vnd: 0,
      usdText: '$0.00',
      vndText: '0 ₫',
      // @ts-expect-error Test fixture uses a timestamp placeholder for a branded date.
      fxAsOf: '2026-01-01T00:00:00.000Z',
    },
    // @ts-expect-error Test fixture uses a timestamp placeholder for a branded date.
    startedAt: '2026-01-01T00:00:00.000Z',
  };
}

function setup(stage: PipelineRun['stage'], withRun = false) {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  const startingRun = pipeline(stage);
  transport.send = (line) => {
    transport.sent.push(line);
    const request = JSON.parse(line) as { readonly id?: number; readonly method?: string };
    if (request.id === undefined || request.method === undefined) return Promise.resolve();
    const result =
      request.method === 'pipeline.list'
        ? withRun
          ? [startingRun]
          : []
        : request.method === 'pipeline.start'
          ? startingRun
          : request.method === 'pipeline.cancel'
            ? pipeline(PipelineStage.CANCELLED)
            : startingRun;
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    return Promise.resolve();
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = new RpcClient(transport);
  render(
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider client={client}>
        {/* @ts-expect-error Readable test identifier stands in for the branded ProjectId. */}
        <CodePage projectId="project-1" />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
  return transport;
}

describe('CodePage', () => {
  it('selects the pipeline run referenced by a workflow deep link', async () => {
    useNavigationIntent.getState().setIntent({ kind: 'pipelineRun', id: 'run-1' });
    setup(PipelineStage.COMPLETED, true);
    const run = await screen.findByRole('button', { name: /Build a sample/ });
    await waitFor(() => expect(run).toHaveAttribute('aria-current', 'true'));
    expect(useNavigationIntent.getState().intent).toBeNull();
  });
  it('starts a run through RPC and asks for confirmation when cancelling during writing', async () => {
    const transport = setup(PipelineStage.WRITING);
    fireEvent.change(screen.getByLabelText('What should we build?'), { target: { value: 'Build a sample' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('pipeline.start'))).toBe(true);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Cancelling will roll back workspace changes.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and roll back' }));
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('pipeline.cancel'))).toBe(true);
    });
  });

  it('cancels before writing without opening the rollback confirmation', async () => {
    const transport = setup(PipelineStage.CODING);
    fireEvent.change(screen.getByLabelText('What should we build?'), { target: { value: 'Build a sample' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('pipeline.cancel'))).toBe(true);
    });
  });
});
