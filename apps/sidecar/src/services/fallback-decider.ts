import type { FallbackDecision, FallbackDecisionRequest, LlmRequest, PriceTable } from '@itstudio/schemas';
import type { IClock } from '../infra/clock.js';
import type { RpcEventBus } from '../rpc/event-bus.js';
import { estimateRequestCost, findPrice } from '../domain/cost.js';
import { isoDateTimeSchema } from '../validation/brand.js';
import type { FallbackDeciderResult, IFallbackDecider } from './llm-router.js';
import type { ModelRegistry } from './model-registry.js';
import { microUsdSchema } from '../validation/brand.js';

export interface UserFallbackDeciderDependencies {
  readonly events: RpcEventBus;
  readonly clock: IClock;
  readonly models: ModelRegistry;
  readonly priceTable: () => PriceTable;
}

interface PendingDecision {
  readonly request: FallbackDecisionRequest;
  readonly resolve: (decision: FallbackDeciderResult) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export class UserFallbackDecider implements IFallbackDecider {
  private readonly events: RpcEventBus;
  private readonly clock: IClock;
  private readonly models: ModelRegistry;
  private readonly priceTable: () => PriceTable;
  private readonly pending = new Map<string, PendingDecision>();

  constructor(dependencies: UserFallbackDeciderDependencies) {
    this.events = dependencies.events;
    this.clock = dependencies.clock;
    this.models = dependencies.models;
    this.priceTable = dependencies.priceTable;
  }

  decide(request: FallbackDecisionRequest, source: LlmRequest, timeoutMs: number): Promise<FallbackDeciderResult> {
    const table = this.priceTable();
    const promptChars =
      (source.systemPrompt?.length ?? 0) +
      source.messages.reduce(
        (total, message) =>
          total + message.parts.reduce((length, part) => length + (part.type === 'text' ? part.text.length : 0), 0),
        0,
      );
    const candidates = request.candidates.map(({ modelKey }) => {
      const price = findPrice(table, modelKey);
      const model = this.models.get(modelKey);
      return {
        modelKey,
        estimatedCostMicroUsd: microUsdSchema.parse(
          price === undefined
            ? 0
            : estimateRequestCost(promptChars, source.maxOutputTokens ?? model?.maxOutputTokens ?? 0, price),
        ),
      };
    });
    const decisionRequest: FallbackDecisionRequest = {
      ...request,
      candidates,
      expiresAt: isoDateTimeSchema.parse(new Date(this.clock.now().getTime() + timeoutMs).toISOString()),
    };

    this.events.publish('router.fallbackRequired', decisionRequest);
    return new Promise<FallbackDeciderResult>((resolve) => {
      const remainingMs = Math.max(0, Date.parse(decisionRequest.expiresAt) - this.clock.now().getTime());
      const timeout = setTimeout(() => {
        const pending = this.pending.get(request.requestId);
        if (pending === undefined) return;
        this.pending.delete(request.requestId);
        pending.resolve({ requestId: request.requestId, action: 'user_timeout' });
      }, remainingMs);
      this.pending.set(request.requestId, { request: decisionRequest, resolve, timeout });
    });
  }

  resolve(decision: FallbackDecision): { readonly accepted: boolean } {
    const pending = this.pending.get(decision.requestId);
    if (pending === undefined) return { accepted: false };
    if (
      decision.action === 'use_model' &&
      !pending.request.candidates.some((candidate) => candidate.modelKey === decision.modelKey)
    )
      return { accepted: false };
    this.pending.delete(decision.requestId);
    clearTimeout(pending.timeout);
    pending.resolve(decision);
    return { accepted: true };
  }
}
