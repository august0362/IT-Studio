import { PipelineStage, type PipelineStage as PipelineStageType } from '@itstudio/schemas';

export type PipelineAction =
  | 'spec_ready'
  | 'code_ready'
  | 'approved'
  | 'rejected'
  | 'fix_ready'
  | 'write_done'
  | 'write_failed'
  | 'validation_passed'
  | 'validation_failed'
  | 'cancel';

export const PIPELINE_TRANSITIONS: Readonly<
  Record<PipelineStageType, Readonly<Partial<Record<PipelineAction, PipelineStageType>>>>
> = {
  [PipelineStage.SPECIFYING]: { spec_ready: PipelineStage.CODING, cancel: PipelineStage.CANCELLED },
  [PipelineStage.CODING]: { code_ready: PipelineStage.REVIEWING, cancel: PipelineStage.CANCELLED },
  [PipelineStage.REVIEWING]: {
    approved: PipelineStage.WRITING,
    rejected: PipelineStage.FIXING,
    cancel: PipelineStage.CANCELLED,
  },
  [PipelineStage.FIXING]: { fix_ready: PipelineStage.RE_REVIEWING, cancel: PipelineStage.CANCELLED },
  [PipelineStage.RE_REVIEWING]: {
    approved: PipelineStage.WRITING,
    rejected: PipelineStage.FAILED,
    cancel: PipelineStage.CANCELLED,
  },
  [PipelineStage.WRITING]: {
    write_done: PipelineStage.VALIDATING,
    write_failed: PipelineStage.ROLLED_BACK,
    cancel: PipelineStage.ROLLED_BACK,
  },
  [PipelineStage.VALIDATING]: {
    validation_passed: PipelineStage.COMPLETED,
    validation_failed: PipelineStage.ROLLED_BACK,
    cancel: PipelineStage.ROLLED_BACK,
  },
  [PipelineStage.COMPLETED]: {},
  [PipelineStage.ROLLED_BACK]: {},
  [PipelineStage.FAILED]: {},
  [PipelineStage.CANCELLED]: {},
};

export function transitionPipelineStage(stage: PipelineStageType, action: PipelineAction): PipelineStageType {
  const next = PIPELINE_TRANSITIONS[stage][action];
  if (next === undefined) throw new Error(`Illegal pipeline transition: ${stage} + ${action}`);
  return next;
}
