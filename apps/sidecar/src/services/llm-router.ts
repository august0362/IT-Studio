import {
  ErrorCode,
  FailureKind,
  RouterState,
  type AppError,
  type FallbackDecision,
  type FallbackDecisionRequest,
  type FailureKind as FailureKindType,
  type LlmRequest,
  type LlmResponse,
  type ModelKey,
  type ProviderId,
  type Result,
  type RouterAttempt,
  type RouterConfig,
  type RouterState as RouterStateType,
} from '@itstudio/schemas';
import type { Logger } from 'pino';
import type { IClock } from '../infra/clock.js';
import type { IIdGenerator } from '../infra/id.js';
import type { ISecretStore } from '../ports/secret-store.js';
import type { ILlmProvider, ProviderRequest } from '../ports/llm-provider.js';
import type { ProviderRegistry } from '../providers/provider-registry.js';
import type { ModelRegistry } from './model-registry.js';
import type { IBudgetGuard } from '../ports/budget-guard.js';
import type { EventBus, RpcEventBus } from '../rpc/event-bus.js';
import { failureToAppError } from '../domain/failure.js';
import { retryDelayMs } from '../domain/backoff.js';
import { transition, type MachineContext, type MachineEffect, type MachineInput } from '../domain/router-machine.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { isoDateTimeSchema, messageIdSchema, microUsdSchema } from '../validation/brand.js';

export interface RouterCompleted {
  readonly requestId: LlmRequest['id'];
  readonly projectId: LlmRequest['projectId'];
  readonly purpose: LlmRequest['purpose'];
  readonly modelKey: ModelKey;
  readonly usage: LlmResponse['usage'];
  readonly billedFailure: boolean;
}

export interface IFallbackDecider {
  decide(request: FallbackDecisionRequest, source: LlmRequest, timeoutMs: number): Promise<FallbackDeciderResult>;
  resolve?(decision: FallbackDecision): { readonly accepted: boolean };
}

export type FallbackDeciderResult =
  FallbackDecision | { readonly requestId: LlmRequest['id']; readonly action: 'user_timeout' };

const rejectFallback: IFallbackDecider = {
  decide: ({ requestId }) => Promise.resolve({ requestId, action: 'abort' }),
};

export interface LlmRouterDependencies {
  readonly models: ModelRegistry;
  readonly providers: ProviderRegistry;
  readonly secrets: ISecretStore;
  readonly budget: IBudgetGuard;
  readonly estimateCostMicroUsd: (request: LlmRequest, modelKey: ModelKey) => number;
  readonly config: () => Promise<Result<RouterConfig>>;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: Logger;
  readonly events: RpcEventBus;
  readonly completed: EventBus<{ completed: RouterCompleted }>;
  readonly fallbackDecider?: IFallbackDecider;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

interface Candidate {
  readonly modelKey: ModelKey;
  readonly maxRetries: number;
  readonly timeoutMs: number;
}
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function decideBeforeTimeout(
  decision: Promise<FallbackDeciderResult>,
  requestId: LlmRequest['id'],
  timeoutMs: number,
): Promise<FallbackDeciderResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      decision,
      new Promise<FallbackDeciderResult>((resolve) => {
        timeout = setTimeout(() => {
          resolve({ requestId, action: 'user_timeout' });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function appError(
  code: AppError['code'],
  message: string,
  remediation: readonly string[],
  retryable = false,
): AppError {
  return { code, message, remediation, retryable };
}

function makeCandidates(config: RouterConfig, request: LlmRequest): Candidate[] {
  const ordered =
    request.ladderOverride !== undefined
      ? request.ladderOverride.map(
          (modelKey) =>
            config.ladder.find((entry) => entry.modelKey === modelKey) ?? {
              modelKey,
              maxRetries: 0,
              timeoutMs: 30_000,
              priority: 0,
              enabled: true,
            },
        )
      : config.lockedModelKey !== null
        ? [
            config.ladder.find((entry) => entry.modelKey === config.lockedModelKey),
            ...config.ladder
              .filter((entry) => entry.modelKey !== config.lockedModelKey)
              .sort((a, b) => a.priority - b.priority),
          ]
        : [...config.ladder].sort((a, b) => a.priority - b.priority);
  const seen = new Set<ModelKey>();
  return ordered.flatMap((entry) => {
    if (entry === undefined || seen.has(entry.modelKey) || (!request.ladderOverride && !entry.enabled)) return [];
    seen.add(entry.modelKey);
    return [{ modelKey: entry.modelKey, maxRetries: entry.maxRetries, timeoutMs: entry.timeoutMs }];
  });
}

export class LlmRouter {
  readonly completed: EventBus<{ completed: RouterCompleted }>;
  private readonly deps: LlmRouterDependencies;
  private readonly circuits = new Map<string, CircuitBreaker>();

  constructor(dependencies: LlmRouterDependencies) {
    this.deps = dependencies;
    this.completed = dependencies.completed;
  }

  async dispatch(
    request: LlmRequest,
    options: {
      readonly onDelta?: (text: string) => void;
      readonly onReset?: () => void;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<Result<LlmResponse>> {
    const configResult = await this.deps.config();
    if (!configResult.ok) return configResult;
    const config = configResult.value;
    const started = this.deps.clock.monotonicMs();
    const candidates = makeCandidates(config, request);
    const attempts: RouterAttempt[] = [];
    const eligible: Candidate[] = [];
    const seenSkipped = new Set<ModelKey>();
    for (const candidate of candidates) {
      const model = this.deps.models.get(candidate.modelKey);
      const circuit = this.circuit(config);
      const health =
        model === undefined
          ? { eligible: false, reason: 'unknown_model' as const }
          : this.deps.models.eligibility(candidate.modelKey, request.requiredCapabilities, () => true);
      const circuitStatus = circuit.status(candidate.modelKey);
      if (!health.eligible || circuitStatus === 'open') {
        const reason = circuitStatus === 'open' ? FailureKind.CIRCUIT_OPEN : FailureKind.CAPABILITY_MISMATCH;
        attempts.push(this.skipped(candidate.modelKey, reason));
        seenSkipped.add(candidate.modelKey);
      } else eligible.push(candidate);
    }
    let context: MachineContext = {
      candidates: eligible.map(({ modelKey }) => modelKey),
      index: 0,
      retries: 0,
      maxRetries: (modelKey) => eligible.find((candidate) => candidate.modelKey === modelKey)?.maxRetries ?? 0,
      autoFallback: config.autoFallback,
      failedModels: [],
    };
    let state: RouterStateType = RouterState.IDLE;
    let response: LlmResponse | undefined;
    let terminalError: AppError | undefined;
    let budgetApproved = false;
    let lastFailure: { kind: FailureKindType; provider: ProviderId; model: string } | undefined;
    const publishState = (next: RouterStateType, modelKey?: ModelKey): void => {
      state = next;
      this.deps.events.publish('router.event', {
        type: 'state',
        requestId: request.id,
        state: next,
        ...(modelKey === undefined ? {} : { modelKey }),
      });
    };
    const apply = async (input: MachineInput): Promise<void> => {
      const result = transition(state, context, input);
      state = result.state;
      context = result.ctx;
      publishState(result.state);
      await effects(result.effects);
    };
    const effects = async (items: readonly MachineEffect[]): Promise<void> => {
      for (const effect of items) {
        if (effect.type === 'check_budget') {
          const firstCandidate = context.candidates[context.index];
          const estimate = firstCandidate === undefined ? 0 : this.deps.estimateCostMicroUsd(request, firstCandidate);
          const checked = await this.deps.budget.check(request.projectId, estimate);
          if (!checked.ok) {
            terminalError = checked.error;
            state = RouterState.FAILED;
            return;
          }
          budgetApproved = !checked.value.blocking;
          await apply(checked.value.blocking ? { type: 'budget_blocked' } : { type: 'budget_ok' });
        } else if (effect.type === 'dispatch') {
          publishState(RouterState.DISPATCHING, effect.model);
          if (!budgetApproved) {
            const checked = await this.deps.budget.check(
              request.projectId,
              this.deps.estimateCostMicroUsd(request, effect.model),
            );
            if (!checked.ok) {
              terminalError = checked.error;
              publishState(RouterState.FAILED);
              return;
            }
            if (checked.value.blocking) {
              terminalError = appError(ErrorCode.BUDGET_HARD_STOP, 'The project budget blocks this request.', [
                'Raise the project budget or turn off Hard Stop.',
              ]);
              publishState(RouterState.FAILED);
              return;
            }
          }
          budgetApproved = false;
          await execute(effect.model);
        } else if (effect.type === 'wait') {
          await (this.deps.sleep ?? defaultSleep)(
            retryDelayMs(context.retries - 1, effect.ms, this.deps.random ?? Math.random),
          );
          await apply(options.signal?.aborted ? { type: 'cancel' } : { type: 'retry_timer_elapsed' });
        } else if (effect.type === 'emit_fallback') {
          this.deps.events.publish('router.event', {
            type: 'fallback',
            requestId: request.id,
            from: effect.from,
            to: effect.to,
            reason: effect.reason,
          });
        } else if (effect.type === 'discard_partial') {
          options.onReset?.();
        } else if (effect.type === 'request_user_decision') {
          const decisionRequest: FallbackDecisionRequest = {
            requestId: request.id,
            failedModel: effect.failed,
            reason: effect.reason,
            candidates: effect.candidates.map((modelKey) => ({
              modelKey,
              estimatedCostMicroUsd: microUsdSchema.parse(0),
            })),
            expiresAt: isoDateTimeSchema.parse(
              new Date(this.deps.clock.now().getTime() + config.userDecisionTimeoutMs).toISOString(),
            ),
          };
          const decision = await decideBeforeTimeout(
            (this.deps.fallbackDecider ?? rejectFallback).decide(
              decisionRequest,
              request,
              config.userDecisionTimeoutMs,
            ),
            request.id,
            config.userDecisionTimeoutMs,
          );
          if (decision.action === 'user_timeout') await apply({ type: 'user_timeout' });
          else {
            await apply({
              type: 'user_decision',
              decision: decision.action === 'use_model' ? 'use_model' : decision.action,
              ...(decision.action === 'use_model' ? { modelKey: decision.modelKey } : {}),
            });
          }
        } else {
          if (effect.outcome === 'cancelled' && terminalError === undefined)
            terminalError = appError(ErrorCode.CANCELLED, 'The request was cancelled.', [
              'Retry the request when ready.',
            ]);
          if (effect.outcome === 'failed' && effect.error !== undefined && terminalError === undefined) {
            terminalError =
              effect.error === ErrorCode.LADDER_EXHAUSTED
                ? this.exhaustedError(attempts)
                : lastFailure === undefined
                  ? appError(effect.error, 'The request could not be completed.', [
                      'Review the request settings and try again.',
                    ])
                  : failureToAppError({ kind: lastFailure.kind }, lastFailure.provider, lastFailure.model);
            if (effect.error === ErrorCode.FALLBACK_DECLINED)
              terminalError = appError(ErrorCode.FALLBACK_DECLINED, 'Model fallback was declined.', [
                'Choose a model and retry the request.',
              ]);
            if (effect.error === ErrorCode.BUDGET_HARD_STOP)
              terminalError = appError(ErrorCode.BUDGET_HARD_STOP, 'The project budget blocks this request.', [
                'Raise the project budget or turn off Hard Stop.',
              ]);
          }
        }
      }
    };
    const execute = async (modelKey: ModelKey): Promise<void> => {
      if (options.signal?.aborted) {
        await apply({ type: 'cancel' });
        return;
      }
      const model = this.deps.models.get(modelKey);
      const circuit = this.circuit(config);
      if (model === undefined || !circuit.acquire(modelKey)) {
        if (!seenSkipped.has(modelKey)) attempts.push(this.skipped(modelKey, FailureKind.CIRCUIT_OPEN));
        await apply({ type: 'failed', failure: { kind: FailureKind.CIRCUIT_OPEN } });
        return;
      }
      const startedAt = isoDateTimeSchema.parse(this.deps.clock.now().toISOString());
      const attemptStart = this.deps.clock.monotonicMs();
      const secretResult = await this.deps.secrets.get(model.provider);
      if (!secretResult.ok || secretResult.value === null) {
        attempts.push({
          modelKey,
          startedAt,
          latencyMs: Math.max(0, this.deps.clock.monotonicMs() - attemptStart),
          outcome: 'skipped',
          failure: FailureKind.CAPABILITY_MISMATCH,
        });
        await apply({ type: 'failed', failure: { kind: FailureKind.CAPABILITY_MISMATCH } });
        return;
      }
      const adapter = this.deps.providers.get(model.provider);
      if (adapter === undefined) {
        attempts.push({
          modelKey,
          startedAt,
          latencyMs: 0,
          outcome: 'skipped',
          failure: FailureKind.CAPABILITY_MISMATCH,
        });
        await apply({ type: 'failed', failure: { kind: FailureKind.CAPABILITY_MISMATCH } });
        return;
      }
      const controller = new AbortController();
      const relayCancel = (): void => {
        controller.abort();
      };
      options.signal?.addEventListener('abort', relayCancel, { once: true });
      let firstDelta = false;
      const timeout = setTimeout(
        () => {
          controller.abort();
        },
        Math.max(1, eligible.find((candidate) => candidate.modelKey === modelKey)?.timeoutMs ?? 30_000),
      );
      const onDelta = (text: string): void => {
        if (!firstDelta) {
          firstDelta = true;
          clearTimeout(timeout);
          void apply({ type: 'first_token' });
        }
        options.onDelta?.(text);
      };
      const providerRequest: ProviderRequest = {
        modelId: model.providerModelId,
        ...(request.systemPrompt === undefined ? {} : { system: request.systemPrompt }),
        messages: request.messages
          .filter((message) => message.role !== 'system')
          .map((message) => ({
            role:
              message.role === 'tool'
                ? ('tool' as const)
                : message.role === 'assistant'
                  ? ('assistant' as const)
                  : ('user' as const),
            parts: message.parts,
          })),
        ...(request.tools === undefined ? {} : { tools: request.tools }),
        maxOutputTokens: request.maxOutputTokens ?? model.maxOutputTokens,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        responseFormat: request.responseFormat ?? 'text',
        timeoutMs: eligible.find((candidate) => candidate.modelKey === modelKey)?.timeoutMs ?? 30_000,
      };
      let result: Awaited<ReturnType<ILlmProvider['complete']>>;
      try {
        result = request.stream
          ? await adapter.stream(providerRequest, secretResult.value, controller.signal, onDelta)
          : await adapter.complete(providerRequest, secretResult.value, controller.signal);
      } catch {
        result = {
          ok: false,
          error: {
            kind: controller.signal.aborted ? FailureKind.TIMEOUT : FailureKind.SERVER_ERROR,
            billed: false,
            message: 'Provider request failed.',
          },
        };
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', relayCancel);
      }
      const latencyMs = Math.max(0, this.deps.clock.monotonicMs() - attemptStart);
      if (options.signal?.aborted) {
        await apply({ type: 'cancel' });
        return;
      }
      if (controller.signal.aborted && result.ok)
        result = {
          ok: false,
          error: { kind: FailureKind.TIMEOUT, billed: false, message: 'Provider request timed out.' },
        };
      if (result.ok) {
        const attempt: RouterAttempt = { modelKey, startedAt, latencyMs, outcome: 'success' };
        attempts.push(attempt);
        circuit.success(modelKey);
        const conversationId = request.messages[0]?.conversationId;
        if (conversationId === undefined) {
          terminalError = appError(ErrorCode.INTERNAL, 'The request has no conversation context.', [
            'Start a new conversation and retry.',
          ]);
          return;
        }
        const message = {
          id: messageIdSchema.parse(this.deps.ids.uuid()),
          conversationId,
          role: 'assistant' as const,
          parts: result.value.text.length === 0 ? [] : [{ type: 'text' as const, text: result.value.text }],
          modelKey,
          usage: result.value.usage,
          createdAt: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
        };
        response = {
          requestId: request.id,
          modelKey,
          message,
          usage: result.value.usage,
          costMicroUsd: microUsdSchema.parse(0),
          finishReason: result.value.finishReason,
          attempts: [...attempts],
          latencyMs: Math.max(0, this.deps.clock.monotonicMs() - started),
        };
        this.deps.completed.publish('completed', {
          requestId: request.id,
          projectId: request.projectId,
          purpose: request.purpose,
          modelKey,
          usage: result.value.usage,
          billedFailure: false,
        });
        await apply({ type: 'completed' });
      } else {
        const failure = result.error;
        const attempt: RouterAttempt = {
          modelKey,
          startedAt,
          latencyMs,
          outcome: 'failed',
          failure: failure.kind,
          ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
          ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
        };
        attempts.push(attempt);
        this.deps.events.publish('router.event', { type: 'attempt_failed', requestId: request.id, attempt });
        circuit.failure(modelKey, failure.kind);
        lastFailure = { kind: failure.kind, provider: model.provider, model: modelKey };
        if (failure.billed)
          this.deps.completed.publish('completed', {
            requestId: request.id,
            projectId: request.projectId,
            purpose: request.purpose,
            modelKey,
            usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
            billedFailure: true,
          });
        await apply({
          type: 'failed',
          failure: {
            kind: failure.kind,
            ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
          },
        });
      }
    };
    if (options.signal?.aborted)
      return {
        ok: false,
        error: appError(ErrorCode.CANCELLED, 'The request was cancelled.', ['Retry the request when ready.']),
      };
    const cancel = (): void => {
      void apply({ type: 'cancel' });
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      await apply({ type: 'start' });
    } finally {
      options.signal?.removeEventListener('abort', cancel);
    }
    if (response !== undefined) return { ok: true, value: response };
    if (terminalError !== undefined) return { ok: false, error: terminalError };
    return { ok: false, error: this.exhaustedError(attempts) };
  }

  private circuit(config: RouterConfig): CircuitBreaker {
    const key = JSON.stringify(config.circuitBreaker);
    let circuit = this.circuits.get(key);
    if (circuit === undefined) {
      circuit = new CircuitBreaker(config.circuitBreaker, this.deps.clock, (modelKey, status) => {
        this.deps.events.publish('router.event', { type: 'circuit', modelKey, status });
      });
      this.circuits.set(key, circuit);
    }
    return circuit;
  }

  private skipped(modelKey: ModelKey, failure: FailureKindType): RouterAttempt {
    return {
      modelKey,
      startedAt: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
      latencyMs: 0,
      outcome: 'skipped',
      failure,
    };
  }

  private exhaustedError(attempts: readonly RouterAttempt[]): AppError {
    const reasons = attempts.map((attempt) => `${attempt.modelKey}: ${attempt.failure ?? attempt.outcome}`);
    return {
      code: ErrorCode.LADDER_EXHAUSTED,
      message: `Every model in the ladder was unavailable. Attempts: ${reasons.join('; ') || 'none'}.`,
      retryable: false,
      remediation: [
        `Attempted models and reasons: ${reasons.join('; ') || 'none'}.`,
        'Configure an available model and provider key, then retry.',
      ],
    };
  }
}
