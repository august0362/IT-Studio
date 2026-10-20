import { BrowserLocator } from '../../kernel/infra/browser-locator.js';
import { NodeBrowserLauncher } from '../../kernel/infra/node-browser-launcher.js';
import type { ModuleContext } from '../../kernel/module-context.js';
import type { IBrowserLauncher } from '../../kernel/ports/browser-launcher.js';
import type { ProjectsModule } from '../projects/index.js';
import type { SettingsService } from '../settings/index.js';
import { WebChatService } from './services/web-chat-service.js';

export interface WebChatModuleDependencies {
  readonly settings: SettingsService;
  readonly projects: ProjectsModule;
  /** E2E: records launch requests instead of opening a browser. */
  readonly launcher?: IBrowserLauncher | undefined;
}

export function createWebChatModule(ctx: ModuleContext, deps: WebChatModuleDependencies) {
  const service = new WebChatService({
    settings: deps.settings,
    projects: deps.projects.repository,
    context: deps.projects.context,
    launcher: deps.launcher ?? new NodeBrowserLauncher(ctx.logger),
    locator: new BrowserLocator(ctx.fileSystem, ctx.env),
    fileSystem: ctx.fileSystem,
    env: ctx.env,
    logger: ctx.logger,
  });
  return { service };
}

export type WebChatModule = ReturnType<typeof createWebChatModule>;
export { registerWebChatRpc } from './rpc.js';
