import { PipelineStage, type FailureReport } from '@itstudio/schemas';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '../../i18n';
import { FailureReportPanel } from './FailureReportPanel';

afterEach(() => {
  cleanup();
  void i18n.changeLanguage('en');
});

function report(stage: FailureReport['stage'], rolledBack = false): FailureReport {
  return {
    stage,
    rolledBack,
    error: {
      code: 'LADDER_EXHAUSTED',
      message: 'No API key: Anthropic (model-a).',
      retryable: false,
      remediation: ['Add an API key in Settings.'],
    },
    nextSteps: ['Add an API key in Settings.'],
    logExcerpt: '',
  };
}

describe('FailureReportPanel UX-02', () => {
  it.each([
    PipelineStage.SPECIFYING,
    PipelineStage.CLARIFYING,
    PipelineStage.CODING,
    PipelineStage.REVIEWING,
    PipelineStage.FIXING,
    PipelineStage.RE_REVIEWING,
  ])('TC-UX2-report says nothing was written at %s', (stage) => {
    render(<FailureReportPanel report={report(stage)} />);
    expect(screen.getByText('Nothing was written to your project.')).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('code.notRolledBack'))).not.toBeInTheDocument();
    expect(screen.queryByText(i18n.t('code.rolledBack'))).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No API key: Anthropic');
  });
  it.each([PipelineStage.WRITING, PipelineStage.VALIDATING])(
    'TC-UX2-report preserves rollback wording at %s',
    (stage) => {
      const view = render(<FailureReportPanel report={report(stage)} />);
      expect(screen.getByText(i18n.t('code.notRolledBack'))).toBeInTheDocument();
      view.rerender(<FailureReportPanel report={report(stage, true)} />);
      expect(screen.getByText(i18n.t('code.rolledBack'))).toBeInTheDocument();
      expect(screen.queryByText('Nothing was written to your project.')).not.toBeInTheDocument();
    },
  );
  it('TC-UX2-report translates untouched workspace wording to Vietnamese', async () => {
    await i18n.changeLanguage('vi');
    render(<FailureReportPanel report={report(PipelineStage.SPECIFYING)} />);
    expect(screen.getByText(i18n.t('code.nothingWritten'))).toBeInTheDocument();
    expect(i18n.t('code.nothingWritten')).not.toBe('code.nothingWritten');
  });
});
