import { ProviderId, type ProviderId as ProviderIdType } from '@itstudio/schemas';
import { computeTokenCost } from '../../kernel/domain/cost.js';
import type { ModuleContext } from '../../kernel/module-context.js';
import type { ILlmProvider } from '../../kernel/ports/llm-provider.js';
import type { ISecretStore } from '../../kernel/ports/secret-store.js';
import { AnthropicProvider } from '../../kernel/providers/anthropic/anthropic-provider.js';
import { GoogleProvider } from '../../kernel/providers/google/google-provider.js';
import {
  OPENAI_COMPATIBLE_BASE_URLS,
  OpenAiCompatibleProvider,
} from '../../kernel/providers/openai-compatible/openai-compatible-provider.js';
import { ProviderRegistry } from '../../kernel/providers/provider-registry.js';
import { EventBus } from '../../kernel/rpc/event-bus.js';
import { providerIdSchema } from '../../kernel/validation/common.js';
import type { CostModule } from '../cost/index.js';
import type { SettingsService } from '../settings/index.js';
import { UserFallbackDecider } from './services/fallback-decider.js';
import { LlmRouter, type RouterCompleted } from './services/llm-router.js';
import { ModelRegistry } from './services/model-registry.js';
import { RouterConfigService } from './services/router-config-service.js';

export interface ModelCatalogDependencies {
  readonly settings: SettingsService;
  /** E2E: every provider id is served by this scripted provider instead of the real SDK adapter. */
  readonly scriptedProvider?: ((id: ProviderIdType) => ILlmProvider) | undefined;
}

/** Providers, the seeded model registry and the completed-request bus the ledger listens to. */
export function createModelCatalog(ctx: ModuleContext, deps: ModelCatalogDependencies) {
  const { settings, scriptedProvider } = deps;
  const compatibleFactories = Object.fromEntries(
    Object.entries(OPENAI_COMPATIBLE_BASE_URLS).map(([id, baseURL]) => {
      const providerId = providerIdSchema.parse(id);
      return [
        providerId,
        () =>
          scriptedProvider !== undefined
            ? scriptedProvider(providerId)
            : new OpenAiCompatibleProvider({
                id: providerId,
                baseURL:
                  providerId === ProviderId.QWEN
                    ? async () => {
                        const current = await settings.get();
                        if (!current.ok) throw new Error('Could not load provider settings.');
                        return current.value.providers?.qwen?.baseUrl ?? baseURL;
                      }
                    : baseURL,
              }),
      ];
    }),
  );
  const providers = new ProviderRegistry({
    ...compatibleFactories,
    [ProviderId.ANTHROPIC]: () =>
      scriptedProvider !== undefined ? scriptedProvider(ProviderId.ANTHROPIC) : new AnthropicProvider(),
    [ProviderId.GOOGLE]: () =>
      scriptedProvider !== undefined ? scriptedProvider(ProviderId.GOOGLE) : new GoogleProvider(),
  });
  const models = new ModelRegistry(ctx.seeds.models, providers);
  const completed = new EventBus<{ completed: RouterCompleted }>();
  return { providers, models, completed };
}

export type ModelCatalog = ReturnType<typeof createModelCatalog>;

export interface RouterModuleDependencies {
  readonly catalog: ModelCatalog;
  readonly settings: SettingsService;
  readonly secretStore: ISecretStore;
  readonly cost: CostModule;
}

export function createRouterModule(ctx: ModuleContext, deps: RouterModuleDependencies) {
  const { catalog, settings, cost } = deps;
  const { models } = catalog;
  const config = new RouterConfigService({ settings, models });
  const fallbackDecider = new UserFallbackDecider({
    events: ctx.events,
    clock: ctx.clock,
    models,
    priceTable: () => cost.pricing.current(),
    fxRate: () => cost.fx.getEffective(),
  });
  const router = new LlmRouter({
    models,
    providers: catalog.providers,
    secrets: deps.secretStore,
    budget: cost.budget,
    estimateCostMicroUsd: (request, modelKey) => {
      const price = cost.pricing.current().entries.find((entry) => entry.modelKey === modelKey);
      if (price === undefined) return 0;
      const promptText = [
        request.systemPrompt ?? '',
        ...request.messages.flatMap((message) =>
          message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
        ),
      ].join(' ');
      const model = models.get(modelKey);
      return computeTokenCost(
        {
          inputTokens: Math.ceil(promptText.length / 4),
          outputTokens: request.maxOutputTokens ?? model?.maxOutputTokens ?? 0,
          cachedInputTokens: 0,
        },
        price,
      );
    },
    config: async () => {
      const current = await settings.get();
      return current.ok ? { ok: true, value: current.value.router } : current;
    },
    clock: ctx.clock,
    ids: ctx.ids,
    logger: ctx.logger,
    events: ctx.events,
    completed: catalog.completed,
    fallbackDecider,
    ...(ctx.e2e ? { sleep: () => Promise.resolve() } : {}),
  });
  return { config, fallbackDecider, router, models };
}

export type RouterModule = ReturnType<typeof createRouterModule>;
export { LlmRouter, type RouterCompleted } from './services/llm-router.js';
export { registerRouterRpc } from './rpc.js';
