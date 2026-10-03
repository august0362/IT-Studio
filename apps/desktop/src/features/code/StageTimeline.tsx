import { PipelineStage, type PipelineRun } from '@itstudio/schemas';
import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { PipelineRunWithHistory } from './pipeline-store';

const stages = [
  PipelineStage.SPECIFYING,
  PipelineStage.CODING,
  PipelineStage.REVIEWING,
  PipelineStage.FIXING,
  PipelineStage.RE_REVIEWING,
  PipelineStage.WRITING,
  PipelineStage.VALIDATING,
] as const;
const terminalStages = [
  PipelineStage.COMPLETED,
  PipelineStage.ROLLED_BACK,
  PipelineStage.FAILED,
  PipelineStage.CANCELLED,
] as const;
export function StageTimeline({ run }: { readonly run: PipelineRun | PipelineRunWithHistory }): JSX.Element {
  const { t } = useTranslation();
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => {
      setNow(Date.now());
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [run.id]);
  const isFixLoop =
    run.fixAttempts > 0 || run.stage === PipelineStage.FIXING || run.stage === PipelineStage.RE_REVIEWING;
  const visibleStages = stages.filter(
    (stage) => isFixLoop || (stage !== PipelineStage.FIXING && stage !== PipelineStage.RE_REVIEWING),
  );
  const finalStage = terminalStages.includes(run.stage as (typeof terminalStages)[number]) ? run.stage : null;
  const enteredStages = 'enteredStages' in run ? run.enteredStages : [];
  const entered = new Set(enteredStages);
  if (run.failureReport !== undefined) entered.add(run.failureReport.stage);
  if (finalStage === null) entered.add(run.stage);
  const failedStage =
    finalStage === PipelineStage.COMPLETED ? null : (run.failureReport?.stage ?? [...enteredStages].at(-1) ?? null);
  return (
    <ol aria-label={t('code.timeline')} className="space-y-2">
      {visibleStages.map((stage) => {
        const active = stage === run.stage;
        const failed = finalStage !== null && stage === failedStage;
        const done = finalStage === PipelineStage.COMPLETED || (entered.has(stage) && !active && !failed);
        const state = failed ? 'failed' : active ? 'current' : done ? 'done' : 'skipped';
        const icon = failed ? '✕' : done ? '✓' : active ? '●' : '—';
        return (
          <li aria-current={active ? 'step' : undefined} className="flex gap-2" key={stage}>
            <span aria-hidden="true">{icon}</span>
            <span>
              {t(`code.stages.${stage}`)} — {t(`code.states.${state}`)}
            </span>
          </li>
        );
      })}
      {finalStage !== null ? (
        <li aria-current="step" className="flex gap-2" key={finalStage}>
          <span aria-hidden="true">{finalStage === PipelineStage.COMPLETED ? '✓' : '✕'}</span>
          <span>
            {t(`code.stages.${finalStage}`)} —{' '}
            {t(finalStage === PipelineStage.COMPLETED ? 'code.states.done' : 'code.states.failed')}
          </span>
        </li>
      ) : null}
      <li aria-live="polite" className="text-sm text-text-muted">
        {t('code.elapsed', {
          seconds: Math.max(
            0,
            Math.floor(
              ((run.finishedAt === undefined ? now : Date.parse(run.finishedAt)) - Date.parse(run.startedAt)) / 1000,
            ),
          ),
        })}
      </li>
    </ol>
  );
}
