import { PipelineStage } from '@itstudio/schemas';
import { describe, expect, it } from 'vitest';
import { PIPELINE_TRANSITIONS, transitionPipelineStage, type PipelineAction } from './pipeline-machine.js';

describe('pipeline stage machine', () => {
  it('accepts every transition in the explicit table', () => {
    for (const [stage, actions] of Object.entries(PIPELINE_TRANSITIONS)) {
      for (const [action, next] of Object.entries(actions)) {
        expect(transitionPipelineStage(stage as keyof typeof PIPELINE_TRANSITIONS, action as PipelineAction)).toBe(
          next,
        );
      }
    }
  });

  it('rejects every transition absent from the table', () => {
    const actions: readonly PipelineAction[] = [
      'spec_ready',
      'code_ready',
      'approved',
      'rejected',
      'fix_ready',
      'write_done',
      'write_failed',
      'validation_passed',
      'validation_failed',
      'cancel',
    ];
    for (const stage of Object.values(PipelineStage)) {
      for (const action of actions) {
        if (PIPELINE_TRANSITIONS[stage][action] === undefined) {
          expect(() => transitionPipelineStage(stage, action)).toThrow(/Illegal pipeline transition/u);
        }
      }
    }
  });

  it('cancels every active phase and rejects cancellation after termination', () => {
    for (const stage of [
      PipelineStage.SPECIFYING,
      PipelineStage.CODING,
      PipelineStage.REVIEWING,
      PipelineStage.FIXING,
      PipelineStage.RE_REVIEWING,
    ]) {
      expect(transitionPipelineStage(stage, 'cancel')).toBe(PipelineStage.CANCELLED);
    }
    for (const stage of [PipelineStage.WRITING, PipelineStage.VALIDATING]) {
      expect(transitionPipelineStage(stage, 'cancel')).toBe(PipelineStage.ROLLED_BACK);
    }
    for (const stage of [
      PipelineStage.COMPLETED,
      PipelineStage.ROLLED_BACK,
      PipelineStage.FAILED,
      PipelineStage.CANCELLED,
    ]) {
      expect(() => transitionPipelineStage(stage, 'cancel')).toThrow();
    }
  });
});
