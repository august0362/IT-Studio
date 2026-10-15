import type { ClarificationQuestion, PipelineRunId } from '@itstudio/schemas';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClarificationForm } from './ClarificationForm';
import { i18n } from '../../i18n';

const runId = 'run-1' as PipelineRunId;
const question: ClarificationQuestion = {
  id: 'storage',
  question: 'Where should data live?',
  why: 'This determines the API.',
  options: [
    { id: 'local', label: 'Local', detail: 'On this device' },
    { id: 'cloud', label: 'Cloud' },
  ],
  recommendedOptionId: 'local',
  recommendationReason: 'Works offline.',
};

afterEach(() => {
  cleanup();
  void i18n.changeLanguage('en');
});

describe('PSTUDIO-01 ClarificationForm', () => {
  it('shows stored free text as Your answer', () => {
    render(
      <ClarificationForm
        runId={runId}
        readOnly={true}
        onSubmit={vi.fn()}
        questions={[
          {
            ...question,
            answer: {
              freeText: 'SQLite',
              by: 'user',
              at: '2026-10-15T00:00:00.000Z' as NonNullable<ClarificationQuestion['answer']>['at'],
            },
          },
        ]}
      />,
    );
    expect(screen.getByRole('textbox')).toHaveValue('SQLite');
    expect(screen.getByText('Your answer')).toBeInTheDocument();
  });
  it('preselects the recommendation, shows rationale, and submits selected options', () => {
    const onSubmit = vi.fn();
    render(<ClarificationForm runId={runId} questions={[question]} readOnly={false} onSubmit={onSubmit} />);
    expect(screen.getByRole('radio', { name: /Local/ })).toBeChecked();
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByText(question.why)).toBeInTheDocument();
    expect(screen.getByText(question.recommendationReason)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Cloud' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
    expect(onSubmit).toHaveBeenCalledWith([{ questionId: 'storage', optionId: 'cloud' }]);
  });

  it('accepts all recommendations even after entering alternative answers', () => {
    const onSubmit = vi.fn();
    render(
      <ClarificationForm
        runId={runId}
        questions={[question, { ...question, id: 'other', question: 'Second question' }]}
        readOnly={false}
        onSubmit={onSubmit}
      />,
    );
    const text = screen.getAllByRole('textbox')[0];
    if (text === undefined) throw new Error('Missing textarea');
    fireEvent.change(text, { target: { value: 'Custom' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept all recommendations' }));
    expect(onSubmit).toHaveBeenCalledWith([
      { questionId: 'storage', optionId: 'local' },
      { questionId: 'other', optionId: 'local' },
    ]);
  });

  it('supports free text, enforces its limit, and disables blank submissions', () => {
    const onSubmit = vi.fn();
    render(<ClarificationForm runId={runId} questions={[question]} readOnly={false} onSubmit={onSubmit} />);
    const text = screen.getByRole('textbox', { name: 'Your own answer' });
    expect(text).toHaveAttribute('maxlength', '2000');
    fireEvent.change(text, { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: 'Submit answers' })).toBeDisabled();
    fireEvent.change(text, { target: { value: 'SQLite' } });
    expect(screen.getByRole('radio', { name: /Local/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
    expect(onSubmit).toHaveBeenCalledWith([{ questionId: 'storage', freeText: 'SQLite' }]);
  });

  it.each(['auto', 'user'] as const)('renders stored %s answers read-only', (by) => {
    const onSubmit = vi.fn();
    const questions: readonly ClarificationQuestion[] = [
      {
        ...question,
        answer: {
          optionId: by === 'auto' ? 'local' : 'cloud',
          by,
          at: '2026-10-15T00:00:00.000Z' as NonNullable<ClarificationQuestion['answer']>['at'],
        },
      },
    ];
    render(<ClarificationForm runId={runId} questions={questions} readOnly={true} onSubmit={onSubmit} />);
    expect(screen.getByText(by === 'auto' ? 'Auto-chosen' : 'Your answer')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    for (const input of screen.getAllByRole('radio')) expect(input).toBeDisabled();
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('radio', { name: by === 'auto' ? /Local/ : /Cloud/ })).toBeChecked();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
