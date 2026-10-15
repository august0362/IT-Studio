import { PipelineStage, type PipelineRun, type ClarificationQuestion } from '@itstudio/schemas';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function setup(stage: PipelineRun['stage'], withRun = false, clarifications?: readonly ClarificationQuestion[]) {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  let startingRun = { ...pipeline(stage), ...(clarifications === undefined ? {} : { clarifications }) };
  transport.send = (line) => {
    transport.sent.push(line);
    const request = JSON.parse(line) as { readonly id?: number; readonly method?: string };
    if (request.id === undefined || request.method === undefined) return Promise.resolve();
    if (request.method === 'pipeline.answerClarifications')
      startingRun = {
        ...startingRun,
        stage: PipelineStage.CODING,
        clarifications: (startingRun.clarifications ?? []).map((question) => ({
          ...question,
          answer: { optionId: question.recommendedOptionId, by: 'user', at: startingRun.startedAt },
        })),
      };
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
  it('QA-BREAK-02-D04 ignores an older notification snapshot after a newer completion snapshot', async () => {
    const transport = setup(PipelineStage.CODING, true);
    await screen.findByRole('button', { name: 'Cancel run' });
    const send = transport.send.bind(transport);
    const pending: number[] = [];
    transport.send = (line) => {
      const request = JSON.parse(line) as { readonly id: number; readonly method: string };
      if (request.method !== 'pipeline.get') return send(line);
      pending.push(request.id);
      return Promise.resolve();
    };
    await act(async () => {
      for (const stage of [PipelineStage.WRITING, PipelineStage.COMPLETED]) {
        transport.receive(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'pipeline.event',
            params: { type: 'stage', runId: 'run-1', stage },
          }),
        );
      }
      await Promise.resolve();
    });
    expect(pending).toHaveLength(2);
    await act(async () => {
      transport.receive(JSON.stringify({ jsonrpc: '2.0', id: pending[1], result: pipeline(PipelineStage.COMPLETED) }));
      await Promise.resolve();
    });
    await act(async () => {
      transport.receive(JSON.stringify({ jsonrpc: '2.0', id: pending[0], result: pipeline(PipelineStage.WRITING) }));
      await Promise.resolve();
    });
    expect(screen.getByText('Completed — done')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  });
  it('PSTUDIO-01 renders waiting questions before Spec, submits answers, and refetches clarification events', async () => {
    const question: ClarificationQuestion = {
      id: 'storage',
      question: 'Where should data live?',
      why: 'Changes the API.',
      options: [
        { id: 'local', label: 'Local' },
        { id: 'cloud', label: 'Cloud' },
      ],
      recommendedOptionId: 'local',
      recommendationReason: 'Works offline.',
    };
    const transport = setup(PipelineStage.CLARIFYING, true, [question]);
    expect(await screen.findByRole('group', { name: question.question })).toBeInTheDocument();
    const marker = screen.getByText('?');
    expect(marker.closest('li')).toHaveAttribute('aria-current', 'step');
    const timeline = screen.getByRole('list', { name: 'Pipeline stages' });
    expect(timeline.textContent.indexOf('Clarifying')).toBeLessThan(timeline.textContent.indexOf('Specify'));
    transport.receive(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'pipeline.event',
        params: { type: 'clarification', runId: 'run-1', status: 'required' },
      }),
    );
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('pipeline.get'))).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
    await screen.findByText('Your answer');
    expect(
      transport.sent.some(
        (line) => line.includes('pipeline.answerClarifications') && line.includes('"optionId":"local"'),
      ),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Submit answers' })).not.toBeInTheDocument();
  });
  it('TC-MW-009 selects the pipeline run referenced by a workflow deep link', async () => {
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
