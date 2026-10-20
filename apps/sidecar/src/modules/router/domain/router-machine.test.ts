import { describe, expect, it } from 'vitest';
import { ErrorCode, FailureKind, RouterState } from '@itstudio/schemas';
import type { MachineContext, MachineInput, TransitionResult } from './router-machine.js';
import { ILLEGAL, transition } from './router-machine.js';

const a = 'openai/a' as const;
const b = 'anthropic/b' as const;
const c = 'google/c' as const;
const base: MachineContext = {
  candidates: [a, b, c],
  index: 0,
  retries: 0,
  maxRetries: () => 1,
  autoFallback: true,
  failedModels: [],
};

const inputs: readonly MachineInput[] = [
  { type: 'start' },
  { type: 'budget_ok' },
  { type: 'budget_blocked' },
  { type: 'first_token' },
  { type: 'completed' },
  ...Object.values(FailureKind).map((kind) => ({ type: 'failed', failure: { kind } }) as const),
  { type: 'failed', failure: { kind: FailureKind.RATE_LIMITED, retryAfterMs: 2_000 } },
  { type: 'retry_timer_elapsed' },
  { type: 'user_decision', decision: 'use_model', modelKey: b },
  { type: 'user_decision', decision: 'retry_same' },
  { type: 'user_decision', decision: 'abort' },
  { type: 'user_timeout' },
  { type: 'cancel' },
];

const states = Object.values(RouterState);
const noOp = (
  state: MachineContext['candidates'] extends never ? never : (typeof RouterState)[keyof typeof RouterState],
  ctx: MachineContext,
): TransitionResult => ({ state, ctx, effects: [] });

describe('router transition matrix', () => {
  it('lists every state/input pair and ignores illegal transitions', () => {
    for (const state of states) {
      for (const input of inputs) {
        const result = transition(state, base, input);
        if (
          ILLEGAL[state].includes(input.type) ||
          [RouterState.SUCCEEDED, RouterState.FAILED, RouterState.CANCELLED].includes(state as never)
        ) {
          expect(result).toEqual(noOp(state, base));
        }
      }
    }
  });

  it('runs the complete happy path', () => {
    expect(transition(RouterState.IDLE, base, { type: 'start' })).toMatchObject({
      state: RouterState.BUDGET_CHECK,
      effects: [{ type: 'check_budget' }],
    });
    expect(transition(RouterState.BUDGET_CHECK, base, { type: 'budget_ok' })).toMatchObject({
      state: RouterState.DISPATCHING,
      effects: [{ type: 'dispatch', model: a }],
    });
    expect(transition(RouterState.DISPATCHING, base, { type: 'first_token' }).state).toBe(RouterState.STREAMING);
    expect(transition(RouterState.STREAMING, base, { type: 'completed' })).toMatchObject({
      state: RouterState.SUCCEEDED,
      effects: [{ type: 'finish', outcome: 'succeeded' }],
    });
  });

  it('retries a transient failure and succeeds after the timer', () => {
    const failed = transition(RouterState.DISPATCHING, base, {
      type: 'failed',
      failure: { kind: FailureKind.SERVER_ERROR },
    });
    expect(failed).toMatchObject({
      state: RouterState.RETRY_WAIT,
      ctx: { retries: 1 },
      effects: [{ type: 'wait', ms: 500 }],
    });
    expect(transition(failed.state, failed.ctx, { type: 'retry_timer_elapsed' })).toMatchObject({
      state: RouterState.DISPATCHING,
      effects: [{ type: 'dispatch', model: a }],
    });
    expect(
      transition(
        RouterState.DISPATCHING,
        { ...base, retries: 1 },
        { type: 'failed', failure: { kind: FailureKind.TIMEOUT } },
      ),
    ).toMatchObject({
      state: RouterState.FALLING_BACK,
      effects: [
        { type: 'emit_fallback', from: a, to: b },
        { type: 'dispatch', model: b },
      ],
    });
  });

  it('falls back immediately for quota and for rate limits without a short retry-after', () => {
    expect(
      transition(RouterState.DISPATCHING, base, { type: 'failed', failure: { kind: FailureKind.QUOTA_EXHAUSTED } }),
    ).toMatchObject({
      state: RouterState.FALLING_BACK,
      ctx: { index: 1 },
      effects: [
        { type: 'emit_fallback', reason: FailureKind.QUOTA_EXHAUSTED },
        { type: 'dispatch', model: b },
      ],
    });
    expect(
      transition(RouterState.DISPATCHING, base, { type: 'failed', failure: { kind: FailureKind.RATE_LIMITED } }).state,
    ).toBe(RouterState.FALLING_BACK);
  });

  it('fails fast for non-fallback failures and blocked budget', () => {
    expect(
      transition(RouterState.DISPATCHING, base, { type: 'failed', failure: { kind: FailureKind.AUTH } }),
    ).toMatchObject({ state: RouterState.FAILED, effects: [{ type: 'finish', error: ErrorCode.PROVIDER_AUTH }] });
    expect(
      transition(RouterState.DISPATCHING, base, { type: 'failed', failure: { kind: FailureKind.BAD_REQUEST } }),
    ).toMatchObject({
      state: RouterState.FAILED,
      effects: [{ type: 'finish', error: ErrorCode.PROVIDER_BAD_REQUEST }],
    });
    expect(
      transition(RouterState.DISPATCHING, base, { type: 'failed', failure: { kind: FailureKind.CONTENT_FILTERED } }),
    ).toMatchObject({
      state: RouterState.FAILED,
      effects: [{ type: 'finish', error: ErrorCode.PROVIDER_CONTENT_FILTERED }],
    });
    expect(transition(RouterState.BUDGET_CHECK, base, { type: 'budget_blocked' })).toMatchObject({
      state: RouterState.FAILED,
      effects: [{ type: 'finish', error: ErrorCode.BUDGET_HARD_STOP }],
    });
  });

  it('fails when the ladder is exhausted', () => {
    const ctx = { ...base, candidates: [a], retries: 1 };
    expect(
      transition(RouterState.DISPATCHING, ctx, { type: 'failed', failure: { kind: FailureKind.SERVER_ERROR } }),
    ).toMatchObject({ state: RouterState.FAILED, effects: [{ type: 'finish', error: ErrorCode.LADDER_EXHAUSTED }] });
  });

  it('supports Auto OFF choices, timeout, and invalid models', () => {
    const ctx = { ...base, autoFallback: false };
    const waiting = transition(RouterState.DISPATCHING, ctx, {
      type: 'failed',
      failure: { kind: FailureKind.QUOTA_EXHAUSTED },
    });
    expect(waiting).toMatchObject({
      state: RouterState.AWAITING_USER,
      effects: [{ type: 'request_user_decision', failed: a, candidates: [b, c] }],
    });
    expect(
      transition(waiting.state, waiting.ctx, { type: 'user_decision', decision: 'use_model', modelKey: c }),
    ).toMatchObject({ state: RouterState.FALLING_BACK, ctx: { index: 2 }, effects: [{ type: 'dispatch', model: c }] });
    expect(
      transition(waiting.state, waiting.ctx, { type: 'user_decision', decision: 'use_model', modelKey: a }),
    ).toEqual(noOp(waiting.state, waiting.ctx));
    expect(transition(waiting.state, waiting.ctx, { type: 'user_decision', decision: 'use_model' })).toEqual(
      noOp(waiting.state, waiting.ctx),
    );
    expect(transition(waiting.state, waiting.ctx, { type: 'user_decision', decision: 'retry_same' })).toMatchObject({
      state: RouterState.DISPATCHING,
      ctx: { retries: 0, failedModels: [] },
      effects: [{ type: 'dispatch', model: a }],
    });
    expect(transition(waiting.state, waiting.ctx, { type: 'user_decision', decision: 'abort' })).toMatchObject({
      state: RouterState.FAILED,
      effects: [{ type: 'finish', error: ErrorCode.FALLBACK_DECLINED }],
    });
    expect(transition(waiting.state, waiting.ctx, { type: 'user_timeout' })).toMatchObject({
      state: RouterState.FAILED,
      effects: [{ type: 'finish', error: ErrorCode.FALLBACK_DECLINED }],
    });
  });

  it('discards partial output before taking a mid-stream fallback', () => {
    expect(
      transition(RouterState.STREAMING, base, { type: 'failed', failure: { kind: FailureKind.QUOTA_EXHAUSTED } }),
    ).toMatchObject({
      effects: [{ type: 'discard_partial' }, { type: 'emit_fallback' }, { type: 'dispatch', model: b }],
    });
  });

  it('cancels every non-terminal state', () => {
    for (const state of states.filter(
      (candidate) => ![RouterState.SUCCEEDED, RouterState.FAILED, RouterState.CANCELLED].includes(candidate as never),
    )) {
      expect(transition(state, base, { type: 'cancel' })).toMatchObject({
        state: RouterState.CANCELLED,
        effects: [{ type: 'finish', outcome: 'cancelled', error: ErrorCode.CANCELLED }],
      });
    }
  });

  it('handles missing or already failed models and retry-after boundaries', () => {
    const empty: MachineContext = { ...base, candidates: [], index: 0 };
    expect(
      transition(RouterState.DISPATCHING, empty, { type: 'failed', failure: { kind: FailureKind.TIMEOUT } }),
    ).toMatchObject({ state: RouterState.FAILED, effects: [{ type: 'finish', error: ErrorCode.LADDER_EXHAUSTED }] });
    expect(transition(RouterState.BUDGET_CHECK, empty, { type: 'budget_ok' }).state).toBe(RouterState.FAILED);
    expect(transition(RouterState.RETRY_WAIT, empty, { type: 'retry_timer_elapsed' }).state).toBe(RouterState.FAILED);
    expect(transition(RouterState.AWAITING_USER, empty, { type: 'user_decision', decision: 'retry_same' }).state).toBe(
      RouterState.FAILED,
    );
    expect(
      transition(RouterState.DISPATCHING, base, {
        type: 'failed',
        failure: { kind: FailureKind.RATE_LIMITED, retryAfterMs: 10_000 },
      }).state,
    ).toBe(RouterState.RETRY_WAIT);
    expect(
      transition(RouterState.DISPATCHING, base, {
        type: 'failed',
        failure: { kind: FailureKind.RATE_LIMITED, retryAfterMs: 10_001 },
      }).state,
    ).toBe(RouterState.FALLING_BACK);
    expect(
      transition(
        RouterState.DISPATCHING,
        { ...base, failedModels: [a, b] },
        { type: 'failed', failure: { kind: FailureKind.QUOTA_EXHAUSTED } },
      ),
    ).toMatchObject({ state: RouterState.FALLING_BACK, ctx: { index: 2 } });
  });
});
