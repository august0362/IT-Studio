import {
  ErrorCode,
  FailureKind,
  ModelCapability,
  ProviderId,
  type LlmRequest,
  type ModelDescriptor,
  type ModelKey,
  type Result,
} from '@itstudio/schemas';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../infra/clock.js';
import { createFakeIdGenerator } from '../infra/id.js';
import { MemorySecretStore } from '../infra/memory-secret-store.js';
import type { ILlmProvider, ProviderFailure, ProviderRequest, ProviderResponse } from '../ports/llm-provider.js';
import type { RpcNotificationMap } from '@itstudio/schemas';
import { FakeLlmProvider, providerFailure, responseFor } from '../providers/__contract__/fake-llm-provider.js';
import { ProviderRegistry } from '../providers/provider-registry.js';
import { EventBus } from '../rpc/event-bus.js';
import {
  conversationIdSchema,
  isoDateTimeSchema,
  llmRequestIdSchema,
  messageIdSchema,
  projectIdSchema,
} from '../validation/brand.js';
import { modelKeySchema } from '../validation/common.js';
import { AlwaysOkBudgetGuard, type IBudgetGuard } from '../ports/budget-guard.js';
import { ModelRegistry } from './model-registry.js';
import { LlmRouter, type IFallbackDecider, type RouterCompleted } from './llm-router.js';

const modelA = modelKeySchema.parse('openai/model-a');
const modelB = modelKeySchema.parse('anthropic/model-b');
const modelDescriptors: readonly ModelDescriptor[] = [
  {
    key: modelA,
    provider: ProviderId.OPENAI,
    providerModelId: 'model-a',
    displayName: 'A',
    capabilities: [ModelCapability.CHAT],
    contextWindowTokens: 1000,
    maxOutputTokens: 100,
    enabled: true,
  },
  {
    key: modelB,
    provider: ProviderId.ANTHROPIC,
    providerModelId: 'model-b',
    displayName: 'B',
    capabilities: [ModelCapability.CHAT],
    contextWindowTokens: 1000,
    maxOutputTokens: 100,
    enabled: true,
  },
];
const baseRequest: LlmRequest = {
  id: llmRequestIdSchema.parse('00000000-0000-4000-8000-000000000001'),
  projectId: projectIdSchema.parse('00000000-0000-4000-8000-000000000002'),
  purpose: 'chat',
  messages: [
    {
      id: messageIdSchema.parse('00000000-0000-4000-8000-000000000003'),
      conversationId: conversationIdSchema.parse('00000000-0000-4000-8000-000000000004'),
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
      createdAt: isoDateTimeSchema.parse('2026-10-02T00:00:00.000Z'),
    },
  ],
  requiredCapabilities: [ModelCapability.CHAT],
  stream: false,
};

function fakeProviderRequest(modelId: string): ProviderRequest {
  return { modelId, messages: [], maxOutputTokens: 10, responseFormat: 'text', timeoutMs: 50 };
}

class ScriptedProvider implements ILlmProvider {
  readonly id: ProviderId;
  readonly calls: string[] = [];
  private readonly results: Result<ProviderResponse, ProviderFailure>[];

  constructor(id: ProviderId, results: Result<ProviderResponse, ProviderFailure>[]) {
    this.id = id;
    this.results = [...results];
  }

  complete(req: ProviderRequest): Promise<Result<ProviderResponse, ProviderFailure>> {
    this.calls.push(req.modelId);
    return Promise.resolve(this.results.shift() ?? { ok: true, value: responseFor(req, 'answer') });
  }

  stream(
    req: ProviderRequest,
    _key: string,
    signal: AbortSignal,
    onDelta: (text: string) => void,
  ): Promise<Result<ProviderResponse, ProviderFailure>> {
    this.calls.push(req.modelId);
    if (signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
    onDelta('partial');
    return Promise.resolve(this.results.shift() ?? { ok: true, value: responseFor(req, 'answer') });
  }

  listModels(): Promise<Result<readonly string[], ProviderFailure>> {
    return Promise.resolve({ ok: true, value: [] });
  }
}

function setup(
  options: {
    readonly first?: ILlmProvider;
    readonly second?: ILlmProvider;
    readonly maxRetries?: number;
    readonly lockedModelKey?: ModelKey | null;
    readonly ladderOverride?: readonly ModelKey[];
    readonly sleep?: (ms: number) => Promise<void>;
    readonly failureThreshold?: number;
    readonly autoFallback?: boolean;
    readonly budget?: IBudgetGuard;
    readonly estimate?: number;
    readonly fallbackDecider?: IFallbackDecider;
  } = {},
) {
  const first = options.first ?? new FakeLlmProvider();
  const second = options.second ?? new ScriptedProvider(ProviderId.ANTHROPIC, []);
  const providers = new ProviderRegistry({ [ProviderId.OPENAI]: () => first, [ProviderId.ANTHROPIC]: () => second });
  const models = new ModelRegistry(modelDescriptors, providers);
  const secrets = new MemorySecretStore();
  void secrets.set(ProviderId.OPENAI, 'secret-a');
  void secrets.set(ProviderId.ANTHROPIC, 'secret-b');
  const events = new EventBus<RpcNotificationMap>();
  const completed = new EventBus<{ completed: RouterCompleted }>();
  const config = {
    ladder: [
      { modelKey: modelA, priority: 1, enabled: true, maxRetries: options.maxRetries ?? 0, timeoutMs: 50 },
      { modelKey: modelB, priority: 2, enabled: true, maxRetries: 0, timeoutMs: 50 },
    ],
    autoFallback: options.autoFallback ?? true,
    lockedModelKey: options.lockedModelKey ?? null,
    circuitBreaker: { failureThreshold: options.failureThreshold ?? 1, cooldownMs: 100 },
    userDecisionTimeoutMs: 10,
  } as const;
  const router = new LlmRouter({
    models,
    providers,
    secrets,
    budget: options.budget ?? new AlwaysOkBudgetGuard(),
    estimateCostMicroUsd: () => options.estimate ?? 0,
    config: () => Promise.resolve({ ok: true, value: config }),
    clock: createFakeClock(new Date('2026-10-02T00:00:00.000Z')),
    ids: createFakeIdGenerator(
      Array.from({ length: 100 }, (_, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`),
    ),
    logger: pino({ enabled: false }),
    events,
    completed,
    ...(options.fallbackDecider === undefined ? {} : { fallbackDecider: options.fallbackDecider }),
    sleep: options.sleep ?? (() => Promise.resolve()),
    random: () => 0.5,
  });
  return { router, events, completed, first, second, secrets };
}

describe('LlmRouter', () => {
  it('returns the successful response and emits completion', async () => {
    const h = setup();
    const completions: RouterCompleted[] = [];
    h.completed.subscribe('completed', (event) => completions.push(event));
    const result = await h.router.dispatch(baseRequest);
    expect(result).toMatchObject({
      ok: true,
      value: { modelKey: modelA, costMicroUsd: 0, attempts: [{ outcome: 'success' }] },
    });
    expect(completions).toMatchObject([{ requestId: baseRequest.id, modelKey: modelA, billedFailure: false }]);
  });

  it('reports missing conversation context as an internal error', async () => {
    const h = setup();
    const result = await h.router.dispatch({ ...baseRequest, messages: [] });
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.INTERNAL } });
  });

  it('skips models without a configured provider secret', async () => {
    const h = setup({ first: new ScriptedProvider(ProviderId.OPENAI, []) });
    await h.secrets.delete(ProviderId.OPENAI);
    const result = await h.router.dispatch(baseRequest);
    expect(result.ok && result.value.modelKey).toBe(modelB);
    expect(result.ok && result.value.attempts[0]).toMatchObject({ modelKey: modelA, outcome: 'skipped' });
  });

  it('retries transient failures before succeeding on the same model', async () => {
    const provider = new ScriptedProvider(ProviderId.OPENAI, [
      providerFailure(FailureKind.SERVER_ERROR),
      { ok: true, value: responseFor(fakeProviderRequest('model-a'), 'recovered') },
    ]);
    const waits: number[] = [];
    const h = setup({
      first: provider,
      maxRetries: 1,
      failureThreshold: 3,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    const result = await h.router.dispatch(baseRequest);
    expect(result.ok && result.value.attempts.map((attempt) => attempt.outcome)).toEqual(['failed', 'success']);
    expect(provider.calls).toHaveLength(2);
    expect(waits).toEqual([500]);
  });

  it('falls back after 429 and emits a fallback event', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, [
      providerFailure(FailureKind.RATE_LIMITED, { httpStatus: 429, retryAfterMs: 20_000 }),
    ]);
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, []);
    const h = setup({ first, second });
    const events: RpcNotificationMap['router.event'][] = [];
    h.events.subscribe('router.event', (event) => events.push(event));
    const result = await h.router.dispatch(baseRequest);
    expect(result.ok && result.value.modelKey).toBe(modelB);
    expect(events).toContainEqual({
      type: 'fallback',
      requestId: baseRequest.id,
      from: modelA,
      to: modelB,
      reason: FailureKind.RATE_LIMITED,
    });
  });

  it('emits an internal completion event for billed failures', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, [
      {
        ok: false,
        error: { kind: FailureKind.SERVER_ERROR, billed: true, message: 'provider failed after billing' },
      },
    ]);
    const h = setup({ first, failureThreshold: 3 });
    const completions: RouterCompleted[] = [];
    h.completed.subscribe('completed', (event) => completions.push(event));
    await h.router.dispatch(baseRequest);
    expect(completions[0]).toMatchObject({
      modelKey: modelA,
      billedFailure: true,
      usage: { inputTokens: 0 },
    });
  });

  it('fails fast on authentication errors', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, [providerFailure(FailureKind.AUTH, { httpStatus: 401 })]);
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, []);
    const h = setup({ first, second });
    const result = await h.router.dispatch(baseRequest);
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.PROVIDER_AUTH } });
    expect(second.calls).toHaveLength(0);
  });

  it('rejects a hard budget stop before calling a provider', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, []);
    let checkedEstimate = 0;
    const h = setup({
      first,
      estimate: 42,
      budget: {
        check: (_projectId, estimate) => {
          checkedEstimate = estimate;
          return Promise.resolve({ ok: true, value: { level: 'exceeded', blocking: true } });
        },
      },
    });
    const result = await h.router.dispatch(baseRequest);
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.BUDGET_HARD_STOP } });
    expect(checkedEstimate).toBe(42);
    expect(first.calls).toHaveLength(0);
  });

  it('delegates manual fallback and returns the declined error', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, [
      providerFailure(FailureKind.RATE_LIMITED, { retryAfterMs: 20_000 }),
    ]);
    const h = setup({ first, autoFallback: false });
    const result = await h.router.dispatch(baseRequest);
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.FALLBACK_DECLINED } });
  });

  it('waits for router.resolveFallback and resumes on the selected model when auto fallback is off', async () => {
    const first = new FakeLlmProvider({ complete: providerFailure(FailureKind.RATE_LIMITED, { httpStatus: 429 }) });
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, []);
    const emitFallback: { current?: (request: Parameters<IFallbackDecider['decide']>[0]) => void } = {};
    const h = setup({
      first,
      second,
      autoFallback: false,
      fallbackDecider: {
        decide: (request) => {
          emitFallback.current?.(request);
          return Promise.resolve({ requestId: request.requestId, action: 'use_model', modelKey: modelB });
        },
      },
    });
    emitFallback.current = (request) => {
      h.events.publish('router.fallbackRequired', request);
    };
    const required: RpcNotificationMap['router.fallbackRequired'][] = [];
    h.events.subscribe('router.fallbackRequired', (request) => required.push(request));
    const result = await h.router.dispatch(baseRequest);
    expect(required).toHaveLength(1);
    expect(result.ok && result.value.modelKey).toBe(modelB);
    expect(second.calls).toEqual(['model-b']);
  });

  it('prioritizes a locked model ahead of the remaining ladder', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, [
      providerFailure(FailureKind.RATE_LIMITED, { retryAfterMs: 20_000 }),
    ]);
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, []);
    const h = setup({ first, second, lockedModelKey: modelB });
    const result = await h.router.dispatch(baseRequest);
    expect(result.ok && result.value.modelKey).toBe(modelB);
    expect(first.calls).toHaveLength(0);
  });

  it('uses ladderOverride order', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, []);
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, []);
    const h = setup({ first, second });
    const result = await h.router.dispatch({ ...baseRequest, ladderOverride: [modelB, modelA] });
    expect(result.ok && result.value.modelKey).toBe(modelB);
    expect(first.calls).toHaveLength(0);
  });

  it('opens a quota circuit and skips the model on the next request', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, [
      providerFailure(FailureKind.QUOTA_EXHAUSTED),
      providerFailure(FailureKind.QUOTA_EXHAUSTED),
    ]);
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, []);
    const h = setup({ first, second });
    await h.router.dispatch(baseRequest);
    const result = await h.router.dispatch({
      ...baseRequest,
      id: llmRequestIdSchema.parse('00000000-0000-4000-8000-000000000006'),
    });
    expect(result.ok && result.value.modelKey).toBe(modelB);
    expect(first.calls).toHaveLength(1);
    expect(result.ok && result.value.attempts[0]?.failure).toBe(FailureKind.CIRCUIT_OPEN);
  });

  it('resets partial output before falling back after a stream failure', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, [providerFailure(FailureKind.SERVER_ERROR)]);
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, []);
    const h = setup({ first, second });
    const deltas: string[] = [];
    let resets = 0;
    const result = await h.router.dispatch(
      { ...baseRequest, stream: true },
      {
        onDelta: (delta) => deltas.push(delta),
        onReset: () => {
          resets += 1;
        },
      },
    );
    expect(result.ok && result.value.modelKey).toBe(modelB);
    expect(deltas).toEqual(['partial', 'partial']);
    expect(resets).toBe(1);
  });

  it('cancels an in-flight stream when the caller aborts', async () => {
    class HangingProvider extends ScriptedProvider {
      override async stream(
        req: ProviderRequest,
        _key: string,
        signal: AbortSignal,
        onDelta: (text: string) => void,
      ): Promise<Result<ProviderResponse, ProviderFailure>> {
        onDelta('partial');
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new DOMException('aborted', 'AbortError'));
            },
            { once: true },
          );
        });
        return { ok: true, value: responseFor(req, 'unexpected') };
      }
    }
    const first = new HangingProvider(ProviderId.OPENAI, []);
    const h = setup({ first, second: new ScriptedProvider(ProviderId.ANTHROPIC, []) });
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 0);
    const result = await h.router.dispatch({ ...baseRequest, stream: true }, { signal: controller.signal });
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.CANCELLED } });
  });

  it('reports all attempted models when the ladder is exhausted', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, [providerFailure(FailureKind.QUOTA_EXHAUSTED)]);
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, [providerFailure(FailureKind.QUOTA_EXHAUSTED)]);
    const h = setup({ first, second });
    const result = await h.router.dispatch(baseRequest);
    expect(result.ok ? '' : result.error.code).toBe(ErrorCode.LADDER_EXHAUSTED);
    expect(result.ok ? '' : result.error.message).toContain(`${modelB}: quota_exhausted`);
  });

  it('fetches secrets per attempt and never publishes their values', async () => {
    const provider = new ScriptedProvider(ProviderId.OPENAI, [
      providerFailure(FailureKind.SERVER_ERROR),
      { ok: true, value: responseFor(fakeProviderRequest('model-a'), 'recovered') },
    ]);
    const h = setup({ first: provider, maxRetries: 1, failureThreshold: 3 });
    let fetches = 0;
    const originalGet = h.secrets.get.bind(h.secrets);
    h.secrets.get = async (providerId) => {
      fetches += 1;
      return originalGet(providerId);
    };
    const events: unknown[] = [];
    h.events.subscribe('router.event', (event) => events.push(event));
    await h.router.dispatch(baseRequest);
    expect(fetches).toBe(2);
    expect(JSON.stringify(events)).not.toContain('secret-a');
    expect(JSON.stringify(events)).not.toContain('secret-b');
  });

  it('does not call a provider when the caller has already cancelled', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, []);
    const h = setup({ first });
    const controller = new AbortController();
    controller.abort();
    const result = await h.router.dispatch(baseRequest, { signal: controller.signal });
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.CANCELLED } });
    expect(first.calls).toHaveLength(0);
  });
});
