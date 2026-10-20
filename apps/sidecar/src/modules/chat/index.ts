import { ChatRepository } from '../../kernel/infra/sqlite/chat-repository.js';
import type { ModuleContext } from '../../kernel/module-context.js';
import type { IProcessTracker } from '../../kernel/ports/process-tracker.js';
import type { CostModule } from '../cost/index.js';
import type { ImagesModule } from '../images/index.js';
import type { KnowledgeModule } from '../knowledge/index.js';
import type { RouterModule } from '../router/index.js';
import type { SettingsService } from '../settings/index.js';
import { ChatService } from './services/chat-service.js';

export interface ChatModuleDependencies {
  readonly processes: IProcessTracker;
  readonly settings: SettingsService;
  readonly router: RouterModule;
  readonly cost: CostModule;
  readonly knowledge: KnowledgeModule;
  readonly images: ImagesModule;
}

export function createChatModule(ctx: ModuleContext, deps: ChatModuleDependencies) {
  const repository = new ChatRepository(ctx.db);
  const service = new ChatService({
    processes: deps.processes,
    repository,
    router: deps.router.router,
    ledger: deps.cost.ledger,
    events: ctx.events,
    ids: ctx.ids,
    clock: ctx.clock,
    logger: ctx.logger,
    retriever: deps.knowledge.retriever,
    settings: deps.settings,
    images: deps.images.service,
  });
  return { repository, service };
}

export type ChatModule = ReturnType<typeof createChatModule>;
export { registerChatRpc } from './rpc.js';
