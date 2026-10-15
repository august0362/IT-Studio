import type { ClarificationQuestion, PipelineRunId, RpcMethodMap } from '@itstudio/schemas';
import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';

interface DraftAnswer {
  readonly optionId?: string;
  readonly freeText?: string;
}

export function ClarificationForm({
  runId,
  questions,
  readOnly,
  onSubmit,
}: {
  readonly runId: PipelineRunId;
  readonly questions: readonly ClarificationQuestion[];
  readonly readOnly: boolean;
  readonly onSubmit: (answers: RpcMethodMap['pipeline.answerClarifications']['params']['answers']) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<Readonly<Record<string, DraftAnswer>>>(() =>
    Object.fromEntries(
      questions.map((question) => [
        question.id,
        question.answer === undefined
          ? { optionId: question.recommendedOptionId }
          : {
              ...(question.answer.optionId === undefined ? {} : { optionId: question.answer.optionId }),
              ...(question.answer.freeText === undefined ? {} : { freeText: question.answer.freeText }),
            },
      ]),
    ),
  );
  const accepted = questions.every((question) => question.answer !== undefined);
  const isReadOnly = readOnly || accepted;
  function update(questionId: string, answer: DraftAnswer): void {
    setAnswers((current) => ({ ...current, [questionId]: answer }));
  }
  function submit(): void {
    onSubmit(questions.map((question) => ({ questionId: question.id, ...answers[question.id] })));
  }
  return (
    <section
      aria-labelledby={`clarifications-${runId}`}
      className="space-y-4 rounded border border-border bg-surface p-4"
    >
      <h3 className="font-semibold" id={`clarifications-${runId}`}>
        {t('code.recommendations')}
      </h3>
      {questions.map((question) => {
        const answer = question.answer;
        const chosen = answer?.optionId;
        const selectedOption = answers[question.id]?.optionId;
        return (
          <fieldset className="space-y-2 border-b border-border pb-4 last:border-0" key={question.id}>
            <legend className="font-medium">{question.question}</legend>
            <p className="text-sm text-text-muted">{question.why}</p>
            {question.options.map((option) => (
              <label className="flex items-start gap-2" key={option.id}>
                <input
                  checked={
                    isReadOnly
                      ? chosen === option.id
                      : selectedOption === option.id && !answers[question.id]?.freeText?.trim()
                  }
                  disabled={isReadOnly}
                  name={`${runId}-${question.id}`}
                  onChange={() => {
                    update(question.id, { optionId: option.id });
                  }}
                  type="radio"
                />
                <span>
                  {option.label}
                  {option.id === question.recommendedOptionId ? (
                    <strong className="ml-2">
                      {t(
                        isReadOnly && answer?.by === 'auto' && chosen === option.id
                          ? 'code.autoChosen'
                          : 'code.recommended',
                      )}
                    </strong>
                  ) : null}
                  {option.detail ? <span className="block text-sm text-text-muted">{option.detail}</span> : null}
                  {option.id === question.recommendedOptionId ? (
                    <span className="block text-sm text-text-muted">{question.recommendationReason}</span>
                  ) : null}
                  {isReadOnly && answer?.by === 'user' && chosen === option.id ? (
                    <strong className="ml-2">{t('code.yourAnswer')}</strong>
                  ) : null}
                </span>
              </label>
            ))}
            <label className="block space-y-1">
              <span>{t('code.freeText')}</span>
              <textarea
                className="w-full rounded border border-border bg-background p-2"
                disabled={isReadOnly}
                maxLength={2000}
                onChange={(event) => {
                  update(question.id, { freeText: event.target.value });
                }}
                value={isReadOnly ? (answer?.freeText ?? '') : (answers[question.id]?.freeText ?? '')}
              />
            </label>
            {isReadOnly && answer?.freeText ? (
              <strong>{answer.by === 'auto' ? t('code.autoChosen') : t('code.yourAnswer')}</strong>
            ) : null}
          </fieldset>
        );
      })}
      {!isReadOnly ? (
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded border border-border px-3 py-2"
            onClick={() => {
              onSubmit(
                questions.map((question) => ({ questionId: question.id, optionId: question.recommendedOptionId })),
              );
            }}
            type="button"
          >
            {t('code.acceptRecommendations')}
          </button>
          <button
            className="rounded bg-primary px-3 py-2 text-primary-fg disabled:opacity-50"
            disabled={
              !questions.every(
                (question) =>
                  answers[question.id]?.optionId !== undefined || Boolean(answers[question.id]?.freeText?.trim()),
              )
            }
            onClick={submit}
            type="button"
          >
            {t('code.submitAnswers')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
