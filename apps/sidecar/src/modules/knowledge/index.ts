import { resolve } from 'node:path';
import { CostPurpose, ProviderId, type ProjectId } from '@itstudio/schemas';
import { computeTokenCost } from '../../kernel/domain/cost.js';
import { LanceDbVectorStore } from '../../kernel/infra/lancedb/vector-store.js';
import { DocumentRepository } from '../../kernel/infra/sqlite/document-repository.js';
import { ProjectRepository } from '../../kernel/infra/sqlite/project-repository.js';
import type { ModuleContext } from '../../kernel/module-context.js';
import type { IEmbeddingProvider } from '../../kernel/ports/embedding-provider.js';
import type { IProcessTracker } from '../../kernel/ports/process-tracker.js';
import type { ISecretStore } from '../../kernel/ports/secret-store.js';
import type { WorkflowInternalEventBus } from '../../kernel/ports/workflow-internal-events.js';
import { GoogleEmbeddingProvider } from '../../kernel/providers/embedding/google.js';
import { OpenAiEmbeddingProvider } from '../../kernel/providers/embedding/openai.js';
import { isoDateTimeSchema } from '../../kernel/validation/brand.js';
import type { CostModule } from '../cost/index.js';
import type { ModelCatalog } from '../router/index.js';
import type { SettingsService } from '../settings/index.js';
import { EmbeddingDispatcher } from './services/embedding-dispatcher.js';
import { RagService } from './services/rag-service.js';
import { Retriever } from './services/retriever.js';

export interface KnowledgeModuleDependencies {
  readonly processes: IProcessTracker;
  readonly settings: SettingsService;
  readonly secretStore: ISecretStore;
  readonly cost: CostModule;
  readonly catalog: ModelCatalog;
  readonly internalEvents: WorkflowInternalEventBus;
  /** E2E: scripted embedding providers replace the OpenAI and Google SDK adapters. */
  readonly embeddingProvider?: ((id: ProviderId) => IEmbeddingProvider) | undefined;
}

export function createKnowledgeModule(ctx: ModuleContext, deps: KnowledgeModuleDependencies) {
  const { settings, cost, internalEvents } = deps;
  const embeddingProviders = {
    [ProviderId.OPENAI]: deps.embeddingProvider?.(ProviderId.OPENAI) ?? new OpenAiEmbeddingProvider(),
    [ProviderId.GOOGLE]: deps.embeddingProvider?.(ProviderId.GOOGLE) ?? new GoogleEmbeddingProvider(),
  };
  const embeddings = {
    embed: async (
      texts: readonly string[],
      context: { readonly projectId: ProjectId; readonly purpose: 'embedding' },
    ) => {
      const currentSettings = await settings.get();
      if (!currentSettings.ok) return currentSettings;
      const dispatcher = new EmbeddingDispatcher({
        config: currentSettings.value.rag.embedding,
        models: ctx.seeds.models,
        providers: embeddingProviders,
        secrets: deps.secretStore,
        ids: ctx.ids,
        budget: cost.budget,
        estimateCostMicroUsd: (modelKey, input) => {
          const price = cost.pricing.current().entries.find((entry) => entry.modelKey === modelKey);
          if (price === undefined) return 0;
          return computeTokenCost(
            {
              inputTokens: input.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
              outputTokens: 0,
              cachedInputTokens: 0,
            },
            price,
          );
        },
        completed: deps.catalog.completed,
        internalEvents,
        ...(ctx.e2e ? { sleep: () => Promise.resolve() } : {}),
      });
      return dispatcher.embed(texts, context);
    },
  };
  const documents = new DocumentRepository(ctx.db);
  const vectors = new LanceDbVectorStore(resolve(ctx.dataDir, 'lancedb'));
  const retriever = new Retriever({ documents, vectors, embeddings, settings, internalEvents });
  const rag = new RagService({
    processes: deps.processes,
    costText: cost.costText,
    projects: new ProjectRepository(ctx.db),
    documents,
    fileSystem: ctx.fileSystem,
    vectors,
    embeddings,
    retriever,
    settings,
    events: ctx.events,
    ids: ctx.ids,
    clock: ctx.clock,
    logger: ctx.logger,
    embeddingCost: async (projectId, startedAt) => {
      let cursor: string | undefined;
      let total = 0;
      do {
        const page = await cost.ledger.query({
          projectId,
          from: isoDateTimeSchema.parse(startedAt),
          purposes: [CostPurpose.EMBEDDING],
          limit: 500,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!page.ok) return total;
        total += page.value.items.reduce((sum, entry) => sum + entry.costMicroUsd, 0);
        cursor = page.value.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return total;
    },
  });
  return { vectors, retriever, rag };
}

export type KnowledgeModule = ReturnType<typeof createKnowledgeModule>;
export type { Retriever } from './services/retriever.js';
export { registerKnowledgeRpc } from './rpc.js';
