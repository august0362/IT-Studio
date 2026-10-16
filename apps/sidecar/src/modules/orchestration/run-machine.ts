import type { OrchRunState, Result } from '@itstudio/schemas';
const transitions: Readonly<Record<OrchRunState, readonly OrchRunState[]>> = {
  draft: ['planning', 'cancelled'],
  planning: ['plan_ready', 'failed', 'cancelled'],
  plan_ready: ['running', 'cancelled'],
  running: ['paused', 'paused_interrupted', 'awaiting_approval', 'failed', 'cancelled'],
  paused: ['running', 'cancelled'],
  paused_interrupted: ['running', 'cancelled'],
  awaiting_approval: ['completed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};
export function transitionRun(state: OrchRunState, next: OrchRunState): Result<OrchRunState> {
  return transitions[state].includes(next)
    ? { ok: true, value: next }
    : {
        ok: false,
        error: { code: 'VALIDATION', message: `Illegal run transition: ${state} -> ${next}`, retryable: false },
      };
}
