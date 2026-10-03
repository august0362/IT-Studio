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
import { describe, expect, it, vi } from 'vitest';
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
  pipelineRunIdSchema,
  projectIdSchema,
  toolCallIdSchema,
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
const baseUserMessage = baseRequest.messages.at(0);
if (baseUserMessage === undefined) throw new Error('Base request must contain a user message');

function fakeProviderRequest(modelId: string): ProviderRequest {
  return { modelId, messages: [], maxOutputTokens: 10, responseFormat: 'text', timeoutMs: 50 };
}

class ScriptedProvider implements ILlmProvider {
  readonly id: ProviderId;
  readonly calls: string[] = [];
  readonly requests: ProviderRequest[] = [];
  private readonly results: Result<ProviderResponse, ProviderFailure>[];

  constructor(id: ProviderId, results: Result<ProviderResponse, ProviderFailure>[]) {
    this.id = id;
    this.results = [...results];
  }

  complete(req: ProviderRequest): Promise<Result<ProviderResponse, ProviderFailure>> {
    this.calls.push(req.modelId);
    this.requests.push(req);
    return Promise.resolve(this.results.shift() ?? { ok: true, value: responseFor(req, 'answer') });
  }

  stream(
    req: ProviderRequest,
    _key: string,
    signal: AbortSignal,
    onDelta: (text: string) => void,
  ): Promise<Result<ProviderResponse, ProviderFailure>> {
    this.calls.push(req.modelId);
    this.requests.push(req);
    if (signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
    onDelta('partial');
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
    readonly disabledModelKey?: ModelKey;
    readonly ladderOverride?: readonly ModelKey[];
    readonly sleep?: (ms: number) => Promise<void>;
    readonly failureThreshold?: number;
    readonly autoFallback?: boolean;
    readonly budget?: IBudgetGuard;
    readonly estimate?: number;
    readonly fallbackDecider?: IFallbackDecider;
    readonly configFailure?: boolean;
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
      {
        modelKey: modelA,
        priority: 1,
        enabled: options.disabledModelKey !== modelA,
        maxRetries: options.maxRetries ?? 0,
        timeoutMs: 50,
      },
      { modelKey: modelB, priority: 2, enabled: options.disabledModelKey !== modelB, maxRetries: 0, timeoutMs: 50 },
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
    config: () =>
      Promise.resolve(
        options.configFailure
          ? {
              ok: false as const,
              error: {
                code: ErrorCode.INTERNAL,
                message: 'Router config unavailable.',
                retryable: false,
                remediation: ['Reload router settings.'],
              },
            }
          : { ok: true as const, value: config },
      ),
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
  it('returns a configuration error before evaluating candidates', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, []);
    const h = setup({ first, configFailure: true });
    const result = await h.router.dispatch(baseRequest);
    expect(result).toMatchObject({
      ok: false,
      error: { code: ErrorCode.INTERNAL, message: 'Router config unavailable.' },
    });
    expect(first.calls).toHaveLength(0);
  });

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

  it('carries pipeline attribution on successful and billed failure completions', async () => {
    const pipelineRunId = pipelineRunIdSchema.parse('00000000-0000-4000-8000-000000000008');
    const success = setup();
    const successes: RouterCompleted[] = [];
    success.completed.subscribe('completed', (event) => successes.push(event));
    await success.router.dispatch({ ...baseRequest, pipelineRunId });
    expect(successes[0]?.pipelineRunId).toBe(pipelineRunId);

    const failedProvider = new ScriptedProvider(ProviderId.OPENAI, [
      {
        ok: false,
        error: { kind: FailureKind.BAD_REQUEST, billed: true, message: 'Billed test failure', httpStatus: 400 },
      },
    ]);
    const failed = setup({ first: failedProvider, autoFallback: false });
    const failures: RouterCompleted[] = [];
    failed.completed.subscribe('completed', (event) => failures.push(event));
    await failed.router.dispatch({ ...baseRequest, pipelineRunId });
    expect(failures[0]).toMatchObject({ pipelineRunId, billedFailure: true });
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

  it('returns budget service errors without dispatching a provider', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, []);
    const h = setup({
      first,
      budget: {
        check: () =>
          Promise.resolve({
            ok: false,
            error: {
              code: ErrorCode.INTERNAL,
              message: 'Budget service unavailable.',
              retryable: true,
              remediation: ['Retry later.'],
            },
          }),
      },
    });
    const result = await h.router.dispatch(baseRequest);
    expect(result).toMatchObject({ ok: false, error: { message: 'Budget service unavailable.' } });
    expect(first.calls).toHaveLength(0);
  });

  it('stops before fallback dispatch when the second budget check blocks', async () => {
    let checks = 0;
    const first = new ScriptedProvider(ProviderId.OPENAI, [providerFailure(FailureKind.SERVER_ERROR)]);
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, []);
    const h = setup({
      first,
      second,
      budget: {
        check: () => {
          checks += 1;
          return Promise.resolve({
            ok: true,
            value: { level: checks === 1 ? 'ok' : 'exceeded', blocking: checks > 1 },
          });
        },
      },
    });
    const result = await h.router.dispatch(baseRequest);
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.BUDGET_HARD_STOP } });
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
  });

  it('returns an error from the budget check before fallback dispatch', async () => {
    let checks = 0;
    const first = new ScriptedProvider(ProviderId.OPENAI, [providerFailure(FailureKind.SERVER_ERROR)]);
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, []);
    const h = setup({
      first,
      second,
      budget: {
        check: () => {
          checks += 1;
          return Promise.resolve(
            checks === 1
              ? { ok: true as const, value: { level: 'ok', blocking: false } }
              : {
                  ok: false as const,
                  error: {
                    code: ErrorCode.INTERNAL,
                    message: 'Second budget check failed.',
                    retryable: true,
                    remediation: ['Retry.'],
                  },
                },
          );
        },
      },
    });
    const result = await h.router.dispatch(baseRequest);
    expect(result).toMatchObject({ ok: false, error: { message: 'Second budget check failed.' } });
    expect(second.calls).toHaveLength(0);
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

  it('fails with a declined decision when the fallback decider times out', async () => {
    vi.useFakeTimers();
    try {
      const first = new ScriptedProvider(ProviderId.OPENAI, [
        providerFailure(FailureKind.RATE_LIMITED, { retryAfterMs: 20_000 }),
      ]);
      let markDecisionStarted: (() => void) | undefined;
      const requestStarted = new Promise<void>((resolveStarted) => {
        markDecisionStarted = resolveStarted;
      });
      const h = setup({
        first,
        autoFallback: false,
        fallbackDecider: {
          decide: () => {
            markDecisionStarted?.();
            return new Promise(() => undefined);
          },
        },
      });
      const dispatch = h.router.dispatch(baseRequest);
      await requestStarted;
      await vi.advanceTimersByTimeAsync(10);
      const result = await dispatch;
      expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.FALLBACK_DECLINED } });
    } finally {
      vi.useRealTimers();
    }
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

  it.each([
    {
      name: 'preferred only',
      preferred: modelB,
      locked: null,
      disabled: undefined,
      firstFails: true,
      expected: [modelB, modelA],
    },
    {
      name: 'preferred then lock',
      preferred: modelA,
      locked: modelB,
      disabled: undefined,
      firstFails: true,
      expected: [modelA, modelB],
    },
    {
      name: 'disabled preferred',
      preferred: modelB,
      locked: null,
      disabled: modelB,
      firstFails: false,
      expected: [modelB],
    },
    {
      name: 'preferred equals lock',
      preferred: modelB,
      locked: modelB,
      disabled: undefined,
      firstFails: true,
      expected: [modelB, modelA],
    },
    {
      name: 'no preference',
      preferred: undefined,
      locked: null,
      disabled: undefined,
      firstFails: false,
      expected: [modelA],
    },
  ])('orders router candidates for $name', async ({ preferred, locked, disabled, firstFails, expected }) => {
    const failure = providerFailure(FailureKind.SERVER_ERROR);
    const first = new ScriptedProvider(ProviderId.OPENAI, firstFails && preferred === modelA ? [failure] : []);
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, firstFails && preferred === modelB ? [failure] : []);
    const h = setup({
      first,
      second,
      lockedModelKey: locked,
      ...(disabled === undefined ? {} : { disabledModelKey: disabled }),
    });
    const result = await h.router.dispatch({
      ...baseRequest,
      ...(preferred === undefined ? {} : { preferredModelKey: preferred }),
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.attempts.map((attempt) => attempt.modelKey)).toEqual(expected);
  });

  it('uses ladderOverride order', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, []);
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, []);
    const h = setup({ first, second });
    const result = await h.router.dispatch({ ...baseRequest, ladderOverride: [modelB, modelA] });
    expect(result.ok && result.value.modelKey).toBe(modelB);
    expect(first.calls).toHaveLength(0);
  });

  it('deduplicates ladder overrides and skips unknown model keys', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, []);
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, []);
    const h = setup({ first, second });
    const unknown = modelKeySchema.parse('openai/not-seeded');
    const result = await h.router.dispatch({
      ...baseRequest,
      ladderOverride: [unknown, modelA, modelA, modelB],
    });
    expect(result.ok && result.value.modelKey).toBe(modelA);
    expect(result.ok && result.value.attempts[0]).toMatchObject({ modelKey: unknown, outcome: 'skipped' });
    expect(first.calls).toEqual(['model-a']);
  });

  it('returns ladder exhausted when no model supports the requested capability', async () => {
    const h = setup();
    const result = await h.router.dispatch({ ...baseRequest, requiredCapabilities: [ModelCapability.VISION] });
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.LADDER_EXHAUSTED } });
  });

  it('maps request options and roles to the provider while allowing an omitted delta callback', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, []);
    const h = setup({ first });
    const request = {
      ...baseRequest,
      systemPrompt: 'System instructions',
      tools: [
        {
          name: 'search_knowledge' as const,
          description: 'Search docs',
          parameters: { type: 'object' as const, properties: {}, required: [] },
          enabled: true,
        },
      ],
      maxOutputTokens: 20,
      temperature: 0.2,
      responseFormat: 'json' as const,
      stream: true,
      messages: [
        ...baseRequest.messages,
        {
          ...baseUserMessage,
          id: messageIdSchema.parse('00000000-0000-4000-8000-000000000007'),
          role: 'assistant' as const,
        },
        {
          ...baseUserMessage,
          id: messageIdSchema.parse('00000000-0000-4000-8000-000000000008'),
          role: 'tool' as const,
        },
      ],
    };
    const result = await h.router.dispatch(request);
    expect(result.ok).toBe(true);
    expect(first.requests[0]).toMatchObject({
      system: 'System instructions',
      tools: request.tools,
      maxOutputTokens: 20,
      temperature: 0.2,
      responseFormat: 'json',
      messages: [{ role: 'user' }, { role: 'assistant' }, { role: 'tool' }],
    });
  });

  it('returns an empty assistant parts list for an empty provider response', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, [
      { ok: true, value: responseFor(fakeProviderRequest('model-a'), '') },
    ]);
    const h = setup({ first });
    const result = await h.router.dispatch(baseRequest);
    expect(result.ok && result.value.message.parts).toEqual([]);
  });

  it.each([false, true])('preserves provider tool calls in streamed=%s assistant messages', async (stream) => {
    const provider = new ScriptedProvider(ProviderId.OPENAI, [
      {
        ok: true,
        value: {
          ...responseFor(fakeProviderRequest('model-a'), ''),
          toolCalls: [{ id: toolCallIdSchema.parse('call_1'), name: 'generate_image', arguments: { prompt: 'a cat' } }],
          finishReason: 'tool_calls',
        },
      },
    ]);
    const h = setup({ first: provider });
    const result = await h.router.dispatch({ ...baseRequest, stream });
    expect(result.ok && result.value.message.parts).toEqual([
      { type: 'tool_call', call: { id: 'call_1', name: 'generate_image', arguments: { prompt: 'a cat' } } },
    ]);
  });

  it('preserves tool calls returned by a provider after fallback', async () => {
    const toolCall = {
      id: toolCallIdSchema.parse('call_2'),
      name: 'generate_image' as const,
      arguments: { prompt: 'a boat' },
    };
    const first = new ScriptedProvider(ProviderId.OPENAI, [providerFailure(FailureKind.RATE_LIMITED)]);
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, [
      {
        ok: true,
        value: {
          ...responseFor(fakeProviderRequest('model-b'), ''),
          toolCalls: [toolCall],
          finishReason: 'tool_calls',
        },
      },
    ]);
    const result = await setup({ first, second }).router.dispatch(baseRequest);
    expect(result.ok && result.value.message.parts).toContainEqual({ type: 'tool_call', call: toolCall });
  });

  it('cancels after a signal is raised during the initial budget check', async () => {
    const controller = new AbortController();
    const first = new ScriptedProvider(ProviderId.OPENAI, []);
    const h = setup({
      first,
      budget: {
        check: () => {
          controller.abort();
          return Promise.resolve({ ok: true, value: { level: 'ok', blocking: false } });
        },
      },
    });
    const result = await h.router.dispatch(baseRequest, { signal: controller.signal });
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.CANCELLED } });
    expect(first.calls).toHaveLength(0);
  });

  it('opens a quota circuit and skips the model on the next request', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, [
      providerFailure(FailureKind.QUOTA_EXHAUSTED),
      providerFailure(FailureKind.QUOTA_EXHAUSTED),
    ]);
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, []);
    const h = setup({ first, second });
    const events: RpcNotificationMap['router.event'][] = [];
    h.events.subscribe('router.event', (event) => events.push(event));
    await h.router.dispatch(baseRequest);
    const result = await h.router.dispatch({
      ...baseRequest,
      id: llmRequestIdSchema.parse('00000000-0000-4000-8000-000000000006'),
    });
    expect(result.ok && result.value.modelKey).toBe(modelB);
    expect(first.calls).toHaveLength(1);
    expect(result.ok && result.value.attempts[0]?.failure).toBe(FailureKind.CIRCUIT_OPEN);
    expect(events).toContainEqual({ type: 'circuit', modelKey: modelA, status: 'open' });
    expect(events).toContainEqual({
      type: 'state',
      requestId: llmRequestIdSchema.parse('00000000-0000-4000-8000-000000000006'),
      state: 'dispatching',
      modelKey: modelB,
    });
  });

  it('resets partial output before falling back after a stream failure', async () => {
    const first = new ScriptedProvider(ProviderId.OPENAI, [providerFailure(FailureKind.SERVER_ERROR)]);
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, []);
    const h = setup({ first, second });
    const deltas: string[] = [];
    const timeline: string[] = [];
    h.events.subscribe('router.event', (event) => {
      if (event.type === 'fallback') timeline.push('fallback');
    });
    let resets = 0;
    const result = await h.router.dispatch(
      { ...baseRequest, stream: true },
      {
        onDelta: (delta) => {
          deltas.push(delta);
          timeline.push('delta');
        },
        onReset: () => {
          resets += 1;
          timeline.push('reset');
        },
      },
    );
    expect(result.ok && result.value.modelKey).toBe(modelB);
    expect(deltas).toEqual(['partial', 'partial', 'partial', 'partial']);
    expect(resets).toBe(1);
    expect(timeline).toEqual(['delta', 'delta', 'reset', 'fallback', 'delta', 'delta']);
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

  it('cancels a retry when the caller aborts during the retry wait', async () => {
    const controller = new AbortController();
    const first = new ScriptedProvider(ProviderId.OPENAI, [providerFailure(FailureKind.SERVER_ERROR)]);
    const h = setup({
      first,
      maxRetries: 1,
      failureThreshold: 3,
      sleep: () => {
        controller.abort();
        return Promise.resolve();
      },
    });
    const result = await h.router.dispatch(baseRequest, { signal: controller.signal });
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.CANCELLED } });
    expect(first.calls).toHaveLength(1);
  });

  it('converts a successful response arriving after the provider timeout into a timeout failure', async () => {
    vi.useFakeTimers();
    try {
      let markEntered: (() => void) | undefined;
      const entered = new Promise<void>((resolveEntered) => {
        markEntered = resolveEntered;
      });
      const first: ILlmProvider = {
        id: ProviderId.OPENAI,
        complete: (request) => {
          if (markEntered !== undefined) markEntered();
          return new Promise((resolveResult) => {
            setTimeout(() => {
              resolveResult({ ok: true, value: responseFor(request, 'late') });
            }, 6_000);
          });
        },
        stream: () => Promise.reject(new Error('not used')),
        listModels: () => Promise.resolve({ ok: true, value: [] }),
      };
      const h = setup({ first, second: new ScriptedProvider(ProviderId.ANTHROPIC, []) });
      const dispatch = h.router.dispatch(baseRequest);
      await entered;
      await vi.advanceTimersByTimeAsync(6_000);
      const result = await dispatch;
      expect(result).toMatchObject({ ok: true, value: { modelKey: modelB } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('converts a thrown provider error into a retryable server failure', async () => {
    const first: ILlmProvider = {
      id: ProviderId.OPENAI,
      complete: () => Promise.reject(new Error('private provider body')),
      stream: () => Promise.reject(new Error('private provider body')),
      listModels: () => Promise.resolve({ ok: true, value: [] }),
    };
    const second = new ScriptedProvider(ProviderId.ANTHROPIC, []);
    const h = setup({ first, second });
    const events: RpcNotificationMap['router.event'][] = [];
    h.events.subscribe('router.event', (event) => events.push(event));
    const result = await h.router.dispatch(baseRequest);
    expect(result.ok && result.value.modelKey).toBe(modelB);
    expect(JSON.stringify(events)).not.toContain('private provider body');
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
