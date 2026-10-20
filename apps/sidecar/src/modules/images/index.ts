import type { GenerateImageArgs, ProcessId, ProjectId } from '@itstudio/schemas';
import { FetchHttpClient } from '../../kernel/infra/http/provider-key-verifier.js';
import { ImageRepository } from '../../kernel/infra/sqlite/image-repository.js';
import type { ModuleContext } from '../../kernel/module-context.js';
import type { IImageProvider } from '../../kernel/ports/image-provider.js';
import type { IProcessTracker } from '../../kernel/ports/process-tracker.js';
import type { ISecretStore } from '../../kernel/ports/secret-store.js';
import type { WorkflowInternalEventBus } from '../../kernel/ports/workflow-internal-events.js';
import { toolCallIdSchema } from '../../kernel/validation/brand.js';
import { FluxReplicateProvider } from '../../kernel/providers/image/flux-replicate.js';
import { FluxTogetherProvider } from '../../kernel/providers/image/flux-together.js';
import { OpenAiDalle3Provider } from '../../kernel/providers/image/openai-dalle3.js';
import type { CostModule } from '../cost/index.js';
import type { SettingsService } from '../settings/index.js';
import { ImageService } from './services/image-service.js';

export interface ImagesModuleDependencies {
  readonly processes: IProcessTracker;
  readonly settings: SettingsService;
  readonly secretStore: ISecretStore;
  readonly cost: CostModule;
  readonly internalEvents: WorkflowInternalEventBus;
  /** E2E: scripted providers replace DALL-E 3 and FLUX. */
  readonly providers?: readonly IImageProvider[] | undefined;
}

export function createImagesModule(ctx: ModuleContext, deps: ImagesModuleDependencies) {
  const { cost, secretStore } = deps;
  const service = new ImageService({
    processes: deps.processes,
    costText: cost.costText,
    repository: new ImageRepository(ctx.db),
    ledger: cost.ledgerRepository,
    budget: cost.budget,
    settings: deps.settings,
    providers: deps.providers ?? [
      new OpenAiDalle3Provider(secretStore),
      new FluxTogetherProvider(secretStore, new FetchHttpClient()),
      new FluxReplicateProvider(secretStore, new FetchHttpClient()),
    ],
    prices: cost.prices,
    fileSystem: ctx.fileSystem,
    dataDir: ctx.filesDir,
    ids: ctx.ids,
    clock: ctx.clock,
    logger: ctx.logger,
    internalEvents: deps.internalEvents,
  });
  return {
    service,
    /** Re-runs a persisted image process (Processes page retry) without a chat tool call. */
    retry: (params: { readonly projectId: ProjectId; readonly args: GenerateImageArgs }, retryOf: ProcessId) =>
      service.generate(
        params.projectId,
        params.args,
        toolCallIdSchema.parse('process_' + ctx.ids.uuid()),
        new AbortController().signal,
        retryOf,
      ),
  };
}

export type ImagesModule = ReturnType<typeof createImagesModule>;
export type { ImageService } from './services/image-service.js';
export { registerImagesRpc } from './rpc.js';
