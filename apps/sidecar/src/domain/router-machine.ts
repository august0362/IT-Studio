import { ErrorCode, FailureKind, RouterState } from '@itstudio/schemas';
import type {
  ErrorCode as ErrorCodeType,
  FailureKind as FailureKindType,
  FallbackDecision,
  ModelKey,
  RouterState as RouterStateType,
} from '@itstudio/schemas';

export interface MachineContext {
  readonly candidates: readonly ModelKey[];
  readonly index: number;
  readonly retries: number;
  readonly maxRetries: (model: ModelKey) => number;
  readonly autoFallback: boolean;
  readonly failedModels: readonly ModelKey[];
}

export type MachineInput =
  | { readonly type: 'start' }
  | { readonly type: 'budget_ok' }
  | { readonly type: 'budget_blocked' }
  | { readonly type: 'first_token' }
  | { readonly type: 'completed' }
  | { readonly type: 'failed'; readonly failure: { readonly kind: FailureKindType; readonly retryAfterMs?: number } }
  | { readonly type: 'retry_timer_elapsed' }
  | { readonly type: 'user_decision'; readonly decision: FallbackDecision['action']; readonly modelKey?: ModelKey }
  | { readonly type: 'user_timeout' }
  | { readonly type: 'cancel' };

export type MachineEffect =
  | { readonly type: 'check_budget' }
  | { readonly type: 'dispatch'; readonly model: ModelKey }
  | { readonly type: 'wait'; readonly ms: number }
  | { readonly type: 'emit_fallback'; readonly from: ModelKey; readonly to: ModelKey; readonly reason: FailureKindType }
  | {
      readonly type: 'request_user_decision';
      readonly failed: ModelKey;
      readonly reason: FailureKindType;
      readonly candidates: readonly ModelKey[];
    }
  | { readonly type: 'discard_partial' }
  | { readonly type: 'finish'; readonly outcome: 'succeeded' | 'failed' | 'cancelled'; readonly error?: ErrorCodeType };

export interface TransitionResult {
  readonly state: RouterStateType;
  readonly ctx: MachineContext;
  readonly effects: readonly MachineEffect[];
}

type InputType = MachineInput['type'];

/** Inputs not handled in a state are intentionally ignored. */
export const ILLEGAL: Readonly<Record<RouterStateType, readonly InputType[]>> = {
  [RouterState.IDLE]: [
    'budget_ok',
    'budget_blocked',
    'first_token',
    'completed',
    'failed',
    'retry_timer_elapsed',
    'user_decision',
    'user_timeout',
  ],
  [RouterState.BUDGET_CHECK]: [
    'start',
    'first_token',
    'completed',
    'failed',
    'retry_timer_elapsed',
    'user_decision',
    'user_timeout',
  ],
  [RouterState.DISPATCHING]: [
    'start',
    'budget_ok',
    'budget_blocked',
    'completed',
    'retry_timer_elapsed',
    'user_decision',
    'user_timeout',
  ],
  [RouterState.STREAMING]: [
    'start',
    'budget_ok',
    'budget_blocked',
    'first_token',
    'retry_timer_elapsed',
    'user_decision',
    'user_timeout',
  ],
  [RouterState.RETRY_WAIT]: [
    'start',
    'budget_ok',
    'budget_blocked',
    'first_token',
    'completed',
    'failed',
    'user_decision',
    'user_timeout',
  ],
  [RouterState.FALLING_BACK]: [
    'start',
    'budget_ok',
    'budget_blocked',
    'retry_timer_elapsed',
    'user_decision',
    'user_timeout',
  ],
  [RouterState.AWAITING_USER]: [
    'start',
    'budget_ok',
    'budget_blocked',
    'first_token',
    'completed',
    'failed',
    'retry_timer_elapsed',
  ],
  [RouterState.SUCCEEDED]: [
    'start',
    'budget_ok',
    'budget_blocked',
    'first_token',
    'completed',
    'failed',
    'retry_timer_elapsed',
    'user_decision',
    'user_timeout',
    'cancel',
  ],
  [RouterState.FAILED]: [
    'start',
    'budget_ok',
    'budget_blocked',
    'first_token',
    'completed',
    'failed',
    'retry_timer_elapsed',
    'user_decision',
    'user_timeout',
    'cancel',
  ],
  [RouterState.CANCELLED]: [
    'start',
    'budget_ok',
    'budget_blocked',
    'first_token',
    'completed',
    'failed',
    'retry_timer_elapsed',
    'user_decision',
    'user_timeout',
    'cancel',
  ],
};

const terminalStates: readonly RouterStateType[] = [RouterState.SUCCEEDED, RouterState.FAILED, RouterState.CANCELLED];
function nextCandidate(ctx: MachineContext): { readonly index: number; readonly model: ModelKey } | undefined {
  for (let index = ctx.index + 1; index < ctx.candidates.length; index += 1) {
    const candidate = ctx.candidates[index];
    if (candidate !== undefined && !ctx.failedModels.includes(candidate)) return { index, model: candidate };
  }
}

type NonFallbackFailure =
  typeof FailureKind.AUTH | typeof FailureKind.BAD_REQUEST | typeof FailureKind.CONTENT_FILTERED;

function errorFor(kind: NonFallbackFailure): ErrorCodeType {
  switch (kind) {
    case FailureKind.AUTH:
      return ErrorCode.PROVIDER_AUTH;
    case FailureKind.BAD_REQUEST:
      return ErrorCode.PROVIDER_BAD_REQUEST;
    case FailureKind.CONTENT_FILTERED:
      return ErrorCode.PROVIDER_CONTENT_FILTERED;
  }
}

function finish(ctx: MachineContext, error: ErrorCodeType, prefix: readonly MachineEffect[] = []): TransitionResult {
  return { state: RouterState.FAILED, ctx, effects: [...prefix, { type: 'finish', outcome: 'failed', error }] };
}

function fail(
  ctx: MachineContext,
  failure: Extract<MachineInput, { type: 'failed' }>['failure'],
  streaming: boolean,
): TransitionResult {
  const model = ctx.candidates[ctx.index];
  if (model === undefined) return finish(ctx, ErrorCode.LADDER_EXHAUSTED);
  const partial = streaming ? [{ type: 'discard_partial' } as const] : [];
  const failedModels = ctx.failedModels.includes(model) ? ctx.failedModels : [...ctx.failedModels, model];
  const failedCtx = { ...ctx, failedModels };

  if (
    failure.kind === FailureKind.AUTH ||
    failure.kind === FailureKind.BAD_REQUEST ||
    failure.kind === FailureKind.CONTENT_FILTERED
  ) {
    return finish(failedCtx, errorFor(failure.kind), partial);
  }

  const retryable =
    failure.kind === FailureKind.SERVER_ERROR ||
    failure.kind === FailureKind.TIMEOUT ||
    (failure.kind === FailureKind.RATE_LIMITED && failure.retryAfterMs !== undefined && failure.retryAfterMs <= 10_000);
  if (retryable && ctx.retries < ctx.maxRetries(model)) {
    const ms = Math.min(failure.retryAfterMs ?? 500 * 2 ** ctx.retries, 10_000);
    return {
      state: RouterState.RETRY_WAIT,
      ctx: { ...ctx, retries: ctx.retries + 1 },
      effects: [...partial, { type: 'wait', ms }],
    };
  }

  const next = nextCandidate(failedCtx);
  if (next === undefined) return finish(failedCtx, ErrorCode.LADDER_EXHAUSTED, partial);
  const remaining = failedCtx.candidates.slice(next.index).filter((candidate) => !failedModels.includes(candidate));
  if (!ctx.autoFallback) {
    return {
      state: RouterState.AWAITING_USER,
      ctx: failedCtx,
      effects: [
        ...partial,
        { type: 'request_user_decision', failed: model, reason: failure.kind, candidates: remaining },
      ],
    };
  }
  return {
    state: RouterState.FALLING_BACK,
    ctx: { ...failedCtx, index: next.index, retries: 0 },
    effects: [
      ...partial,
      { type: 'emit_fallback', from: model, to: next.model, reason: failure.kind },
      { type: 'dispatch', model: next.model },
    ],
  };
}

export function transition(state: RouterStateType, ctx: MachineContext, input: MachineInput): TransitionResult {
  if (terminalStates.includes(state)) return { state, ctx, effects: [] };
  if (ILLEGAL[state].includes(input.type)) return { state, ctx, effects: [] };

  switch (input.type) {
    case 'start':
      return { state: RouterState.BUDGET_CHECK, ctx, effects: [{ type: 'check_budget' }] };
    case 'budget_ok': {
      const model = ctx.candidates[ctx.index];
      if (model === undefined) return finish(ctx, ErrorCode.LADDER_EXHAUSTED);
      return { state: RouterState.DISPATCHING, ctx, effects: [{ type: 'dispatch', model }] };
    }
    case 'budget_blocked':
      return finish(ctx, ErrorCode.BUDGET_HARD_STOP);
    case 'first_token':
      return { state: RouterState.STREAMING, ctx, effects: [] };
    case 'completed':
      return { state: RouterState.SUCCEEDED, ctx, effects: [{ type: 'finish', outcome: 'succeeded' }] };
    case 'failed':
      return fail(ctx, input.failure, state === RouterState.STREAMING);
    case 'retry_timer_elapsed': {
      const model = ctx.candidates[ctx.index];
      if (model === undefined) return finish(ctx, ErrorCode.LADDER_EXHAUSTED);
      return { state: RouterState.DISPATCHING, ctx, effects: [{ type: 'dispatch', model }] };
    }
    case 'user_decision': {
      if (input.decision === 'abort') return finish(ctx, ErrorCode.FALLBACK_DECLINED);
      const current = ctx.candidates[ctx.index];
      if (input.decision === 'retry_same') {
        if (current === undefined) return finish(ctx, ErrorCode.LADDER_EXHAUSTED);
        return {
          state: RouterState.DISPATCHING,
          ctx: { ...ctx, retries: 0, failedModels: ctx.failedModels.filter((model) => model !== current) },
          effects: [{ type: 'dispatch', model: current }],
        };
      }
      const target = input.modelKey;
      const targetIndex =
        target === undefined
          ? -1
          : ctx.candidates.findIndex(
              (candidate, index) => index > ctx.index && candidate === target && !ctx.failedModels.includes(candidate),
            );
      if (targetIndex < 0 || target === undefined) return { state, ctx, effects: [] };
      return {
        state: RouterState.FALLING_BACK,
        ctx: { ...ctx, index: targetIndex, retries: 0 },
        effects: [{ type: 'dispatch', model: target }],
      };
    }
    case 'user_timeout':
      return finish(ctx, ErrorCode.FALLBACK_DECLINED);
    case 'cancel':
      return {
        state: RouterState.CANCELLED,
        ctx,
        effects: [{ type: 'finish', outcome: 'cancelled', error: ErrorCode.CANCELLED }],
      };
  }
}
