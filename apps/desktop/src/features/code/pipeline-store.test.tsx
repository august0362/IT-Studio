import { PipelineStage, type PipelineRun } from '@itstudio/schemas';
import { describe, expect, it } from 'vitest';
import { initialPipelineState, pipelineReducer } from './pipeline-store';

function run(id = 'run-1', stage: PipelineRun['stage'] = PipelineStage.SPECIFYING): PipelineRun {
  return {
    // @ts-expect-error Test fixture uses a readable sidecar-branded id.
    id,
    // @ts-expect-error Test fixture uses a readable sidecar-branded id.
    projectId: 'project-1',
    prompt: 'build',
    stage,
    roleAssignment: { pm: [], coder: [], reviewer: [] },
    coderOutputs: [],
    verdicts: [],
    fixAttempts: 0,
    cost: {
      // @ts-expect-error Test fixture uses an integer for the branded amount.
      microUsd: 1,
      // @ts-expect-error Test fixture uses an integer for the branded amount.
      vnd: 1,
      usdText: '$0.01',
      vndText: '1 ₫',
      // @ts-expect-error Test fixture uses a date string for the branded timestamp.
      fxAsOf: '2026-01-01T00:00:00.000Z',
    },
    // @ts-expect-error Test fixture uses a date string for the branded timestamp.
    startedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('pipelineReducer', () => {
  it('adds, selects and refreshes runs', () => {
    const first = pipelineReducer(initialPipelineState, { type: 'started', run: run() });
    expect(first.selectedRunId).toBe('run-1');
    const second = pipelineReducer(first, { type: 'started', run: run('run-2') });
    expect(second.entries['run-2']?.queued).toBe(true);
    const refreshed = pipelineReducer(first, { type: 'loaded', run: run('run-1', PipelineStage.COMPLETED) });
    expect(refreshed.entries['run-1']?.finished).toBe(true);
    const loadedWithoutPrevious = pipelineReducer(first, {
      type: 'loaded',
      run: run('run-3', PipelineStage.COMPLETED),
    });
    expect(loadedWithoutPrevious.entries['run-3']).toMatchObject({ finished: true, outputs: {}, queued: false });
  });

  it('applies stage, artifact and finished notifications and ignores unknown or terminal runs', () => {
    const initial = pipelineReducer(initialPipelineState, { type: 'started', run: run() });
    const stage = pipelineReducer(initial, {
      type: 'event',
      event: { type: 'stage', runId: run().id, stage: PipelineStage.CODING },
    });
    expect(stage.entries['run-1']?.run.stage).toBe(PipelineStage.CODING);
    const artifact = pipelineReducer(stage, {
      type: 'event',
      event: { type: 'artifact', runId: run().id, kind: 'spec', index: 0 },
    });
    expect(artifact).toBe(stage);
    const unknown = pipelineReducer(initial, {
      type: 'event',
      event: { type: 'stage', runId: 'unknown' as PipelineRun['id'], stage: PipelineStage.CODING },
    });
    expect(unknown).toBe(initial);
    const done = pipelineReducer(stage, {
      type: 'event',
      event: { type: 'finished', runId: run().id, stage: 'completed' },
    });
    expect(done.entries['run-1']?.finished).toBe(true);
    expect(
      pipelineReducer(done, { type: 'event', event: { type: 'stage', runId: run().id, stage: PipelineStage.FAILED } }),
    ).toBe(done);
  });

  it('stores separate stdout and stderr and caps each stream at 2000 lines', () => {
    const started = pipelineReducer(initialPipelineState, { type: 'started', run: run() });
    const stdout = pipelineReducer(started, {
      type: 'event',
      event: {
        type: 'command_output',
        runId: run().id,
        commandRunId: 'cmd-1' as never,
        stream: 'stdout',
        chunk: 'ok\n',
      },
    });
    const stderr = pipelineReducer(stdout, {
      type: 'event',
      event: {
        type: 'command_output',
        runId: run().id,
        commandRunId: 'cmd-1' as never,
        stream: 'stderr',
        chunk: 'oops',
      },
    });
    expect(stderr.entries['run-1']?.outputs['cmd-1']).toMatchObject({
      stdout: 'ok\n',
      stderr: 'oops',
      truncated: false,
    });
    const capped = pipelineReducer(stderr, {
      type: 'event',
      event: {
        type: 'command_output',
        runId: run().id,
        commandRunId: 'cmd-1' as never,
        stream: 'stdout',
        chunk: `${'x\n'.repeat(2000)}new`,
      },
    });
    expect(capped.entries['run-1']?.outputs['cmd-1']?.truncated).toBe(true);
    expect(capped.entries['run-1']?.outputs['cmd-1']?.stdout.split('\n')).toHaveLength(2000);
    const unknown = pipelineReducer(initialPipelineState, {
      type: 'event',
      event: { type: 'command_output', runId: run().id, commandRunId: 'cmd-1' as never, stream: 'stdout', chunk: '' },
    });
    expect(unknown).toBe(initialPipelineState);
  });

  it('attaches failure reports and ignores reports without a run id or for unknown runs', () => {
    const started = pipelineReducer(initialPipelineState, { type: 'started', run: run() });
    const report = {
      runId: run().id,
      stage: PipelineStage.WRITING,
      error: { code: 'INTERNAL', message: 'Failed', retryable: false },
      rolledBack: true,
      nextSteps: ['Retry'],
      logExcerpt: '',
    } as const;
    const failed = pipelineReducer(started, { type: 'failure', report });
    expect(failed.entries['run-1']?.run.failureReport).toBe(report);
    const withoutRunId = {
      stage: report.stage,
      error: report.error,
      rolledBack: report.rolledBack,
      nextSteps: report.nextSteps,
      logExcerpt: report.logExcerpt,
    };
    expect(pipelineReducer(started, { type: 'failure', report: withoutRunId })).toBe(started);
    expect(
      pipelineReducer(started, { type: 'failure', report: { ...report, runId: 'missing' as typeof report.runId } }),
    ).toBe(started);
  });
});
