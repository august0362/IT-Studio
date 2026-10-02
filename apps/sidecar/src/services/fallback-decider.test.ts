import { describe, expect, it, vi } from 'vitest';
import {
  ModelCapability,
  ProviderId,
  type FallbackDecisionRequest,
  type LlmRequest,
  type PriceTable,
  type RpcNotificationMap,
} from '@itstudio/schemas';
import { createFakeClock } from '../infra/clock.js';
import { ModelRegistry } from './model-registry.js';
import { ProviderRegistry } from '../providers/provider-registry.js';
import { EventBus } from '../rpc/event-bus.js';
import {
  conversationIdSchema,
  isoDateTimeSchema,
  llmRequestIdSchema,
  messageIdSchema,
  microUsdSchema,
  priceTableVersionSchema,
  projectIdSchema,
} from '../validation/brand.js';
import { modelKeySchema } from '../validation/common.js';
import { UserFallbackDecider } from './fallback-decider.js';

const modelA = modelKeySchema.parse('openai/model-a');
const modelB = modelKeySchema.parse('anthropic/model-b');
const models = new ModelRegistry(
  [
    {
      key: modelA,
      provider: ProviderId.OPENAI,
      providerModelId: 'a',
      displayName: 'A',
      capabilities: [ModelCapability.CHAT],
      contextWindowTokens: 1000,
      maxOutputTokens: 100,
      enabled: true,
    },
    {
      key: modelB,
      provider: ProviderId.ANTHROPIC,
      providerModelId: 'b',
      displayName: 'B',
      capabilities: [ModelCapability.CHAT],
      contextWindowTokens: 1000,
      maxOutputTokens: 100,
      enabled: true,
    },
  ],
  new ProviderRegistry({}),
);
const priceTable: PriceTable = {
  version: priceTableVersionSchema.parse('test'),
  effectiveFrom: isoDateTimeSchema.parse('2026-01-01T00:00:00.000Z'),
  origin: 'seed',
  entries: [
    {
      modelKey: modelB,
      inputPerMTokMicroUsd: microUsdSchema.parse(1_000_000),
      outputPerMTokMicroUsd: microUsdSchema.parse(2_000_000),
      cachedInputPerMTokMicroUsd: microUsdSchema.parse(0),
      freeTier: false,
      sourceUrl: 'fixture',
    },
  ],
};
const now = new Date('2026-10-02T00:00:00.000Z');
const source: LlmRequest = {
  id: llmRequestIdSchema.parse('00000000-0000-4000-8000-000000000001'),
  projectId: projectIdSchema.parse('00000000-0000-4000-8000-000000000002'),
  purpose: 'chat',
  messages: [
    {
      id: messageIdSchema.parse('00000000-0000-4000-8000-000000000003'),
      conversationId: conversationIdSchema.parse('00000000-0000-4000-8000-000000000004'),
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
      createdAt: isoDateTimeSchema.parse(now.toISOString()),
    },
  ],
  requiredCapabilities: [ModelCapability.CHAT],
  stream: false,
};
function createHarness(timeoutMs = 10_000) {
  const clock = createFakeClock(now);
  const events = new EventBus<RpcNotificationMap>();
  const decider = new UserFallbackDecider({ events, clock, models, priceTable: () => priceTable });
  const request: FallbackDecisionRequest = {
    requestId: source.id,
    failedModel: modelA,
    reason: 'rate_limited',
    candidates: [{ modelKey: modelB, estimatedCostMicroUsd: microUsdSchema.parse(0) }],
    expiresAt: isoDateTimeSchema.parse(new Date(now.getTime() + timeoutMs).toISOString()),
  };
  return { clock, events, decider, request };
}

describe('UserFallbackDecider', () => {
  it('publishes cost estimates and resolves use_model, retry_same and abort decisions', async () => {
    for (const action of ['use_model', 'retry_same', 'abort'] as const) {
      const h = createHarness();
      let published: RpcNotificationMap['router.fallbackRequired'] | undefined;
      h.events.subscribe('router.fallbackRequired', (request) => {
        published = request;
      });
      const waiting = h.decider.decide(h.request, source, 10_000);
      expect(published?.candidates[0]?.estimatedCostMicroUsd).toBe(202);
      const decision =
        action === 'use_model' ? { requestId: source.id, action, modelKey: modelB } : { requestId: source.id, action };
      expect(h.decider.resolve(decision)).toEqual({ accepted: true });
      await expect(waiting).resolves.toEqual(decision);
    }
  });

  it('rejects unknown models and duplicate or late decisions', async () => {
    const h = createHarness();
    const waiting = h.decider.decide(h.request, source, 10_000);
    expect(h.decider.resolve({ requestId: source.id, action: 'use_model', modelKey: modelA })).toEqual({
      accepted: false,
    });
    expect(h.decider.resolve({ requestId: source.id, action: 'abort' })).toEqual({ accepted: true });
    expect(h.decider.resolve({ requestId: source.id, action: 'abort' })).toEqual({ accepted: false });
    await waiting;
    expect(h.decider.resolve({ requestId: source.id, action: 'abort' })).toEqual({ accepted: false });
  });

  it('expires to abort using the injected clock deadline', async () => {
    vi.useFakeTimers();
    try {
      const h = createHarness();
      const waiting = h.decider.decide(h.request, source, 10_000);
      h.clock.advance(10_000);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(waiting).resolves.toEqual({ requestId: source.id, action: 'user_timeout' });
      expect(h.decider.resolve({ requestId: source.id, action: 'abort' })).toEqual({ accepted: false });
    } finally {
      vi.useRealTimers();
    }
  });
});
