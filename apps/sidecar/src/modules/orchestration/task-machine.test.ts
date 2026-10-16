import { describe, expect, it } from 'vitest';
import { legalTaskTransitions, transitionTask } from './task-machine.js';
describe('orchestration task machine', () => {
  it('accepts every declared legal transition', () => {
    for (const [state, nextStates] of Object.entries(legalTaskTransitions()))
      for (const next of nextStates)
        expect(transitionTask(state as keyof ReturnType<typeof legalTaskTransitions>, next).ok).toBe(true);
  });
  it('rejects representative illegal transitions', () => {
    expect(transitionTask('draft', 'completed').ok).toBe(false);
    expect(transitionTask('completed', 'running').ok).toBe(false);
  });
});
