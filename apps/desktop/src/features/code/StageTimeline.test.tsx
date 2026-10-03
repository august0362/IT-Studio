import { PipelineStage, type PipelineStage as PipelineStageType } from '@itstudio/schemas';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '../../i18n';
import { StageTimeline } from './StageTimeline';
import type { PipelineRunWithHistory } from './pipeline-store';

afterEach(cleanup);

function failedRun(stage: PipelineStageType, enteredStages: readonly PipelineStage[]): PipelineRunWithHistory {
  return {
    // @ts-expect-error Test fixture uses a readable placeholder branded run id.
    id: 'run-1',
    // @ts-expect-error Test fixture uses a readable placeholder branded project id.
    projectId: 'project-1',
    prompt: 'Build a sample',
    stage: PipelineStage.FAILED,
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
    // @ts-expect-error Test fixture uses a timestamp placeholder for a branded date.
    finishedAt: '2026-01-01T00:00:01.000Z',
    failureReport: {
      // @ts-expect-error Test fixture uses a readable placeholder branded run id.
      runId: 'run-1',
      stage,
      error: { code: 'INTERNAL', message: 'Failed', retryable: false, remediation: ['Retry.'] },
      rolledBack: false,
      nextSteps: ['Retry'],
      logExcerpt: '',
    },
    enteredStages,
  } satisfies PipelineRunWithHistory;
}

describe('StageTimeline', () => {
  it.each([
    {
      failed: PipelineStage.SPECIFYING,
      entered: [PipelineStage.SPECIFYING],
      done: [],
      skipped: [PipelineStage.CODING, PipelineStage.REVIEWING, PipelineStage.WRITING, PipelineStage.VALIDATING],
    },
    {
      failed: PipelineStage.REVIEWING,
      entered: [PipelineStage.SPECIFYING, PipelineStage.CODING, PipelineStage.REVIEWING],
      done: [PipelineStage.SPECIFYING, PipelineStage.CODING],
      skipped: [PipelineStage.WRITING, PipelineStage.VALIDATING],
    },
    {
      failed: PipelineStage.VALIDATING,
      entered: [
        PipelineStage.SPECIFYING,
        PipelineStage.CODING,
        PipelineStage.REVIEWING,
        PipelineStage.WRITING,
        PipelineStage.VALIDATING,
      ],
      done: [PipelineStage.SPECIFYING, PipelineStage.CODING, PipelineStage.REVIEWING, PipelineStage.WRITING],
      skipped: [],
    },
  ])('marks entered and not-run stages for failure in $failed', ({ failed, entered, done, skipped }) => {
    render(<StageTimeline run={failedRun(failed, entered)} />);
    const timeline = screen.getByRole('list', { name: i18n.t('code.timeline') });
    const item = (stage: PipelineStageType): HTMLElement => {
      const label = i18n.t(`code.stages.${stage}`);
      const found = Array.from(timeline.querySelectorAll('li')).find((li) => li.textContent.includes(label));
      if (found === undefined) throw new Error(`Missing timeline item for ${stage}`);
      return found;
    };

    expect(item(failed)).toHaveTextContent(i18n.t('code.states.failed'));
    expect(within(item(failed)).getByText('✕')).toBeInTheDocument();
    for (const stage of done) expect(item(stage)).toHaveTextContent(i18n.t('code.states.done'));
    for (const stage of skipped) {
      const listItem = item(stage);
      expect(listItem).toHaveTextContent(i18n.t('code.states.skipped'));
      expect(within(listItem).getByText('—')).toBeInTheDocument();
    }
  });
});
