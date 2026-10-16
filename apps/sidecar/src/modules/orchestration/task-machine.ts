import type { OrchTaskState, Result } from '@itstudio/schemas';

const transitions: Readonly<Record<OrchTaskState, readonly OrchTaskState[]>> = {
  draft: ['ready', 'cancelled'],
  ready: ['queued', 'cancelled'],
  queued: ['assigned', 'blocked', 'cancelled'],
  assigned: ['running', 'queued', 'failed', 'cancelled'],
  running: ['awaiting_handoff', 'failed', 'cancelled'],
  awaiting_handoff: ['in_review', 'failed', 'cancelled'],
  in_review: ['fix_required', 'integrating', 'completed', 'failed', 'cancelled'],
  fix_required: ['queued', 'blocked', 'failed', 'cancelled'],
  integrating: ['validating', 'failed', 'cancelled'],
  validating: ['awaiting_approval', 'completed', 'failed', 'cancelled'],
  awaiting_approval: ['completed', 'cancelled'],
  completed: [],
  blocked: [],
  failed: [],
  cancelled: [],
};
export function transitionTask(state: OrchTaskState, next: OrchTaskState): Result<OrchTaskState> {
  return transitions[state].includes(next)
    ? { ok: true, value: next }
    : {
        ok: false,
        error: { code: 'VALIDATION', message: `Illegal task transition: ${state} -> ${next}`, retryable: false },
      };
}
export function legalTaskTransitions(): Readonly<Record<OrchTaskState, readonly OrchTaskState[]>> {
  return transitions;
}
