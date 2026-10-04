import {
  ErrorCode,
  WebChatBrowser,
  type AppError,
  type ProjectId,
  type Result,
  type WebChatLinkId,
  type WebChatSettings,
} from '@itstudio/schemas';
import type { Logger } from 'pino';
import { isAbsolute, join } from 'node:path';
import type { IFileSystem } from '../ports/file-system.js';
import type { IProjectRepository } from '../ports/project-repository.js';
import type { IBrowserLauncher } from '../ports/browser-launcher.js';
import type { SettingsService } from './settings-service.js';
import type { ProjectContextService } from './project-context.js';
import type { BrowserLocator } from '../infra/browser-locator.js';
import { isAllowedWebChatUrl } from '../domain/web-chat.js';

export interface WebChatServiceDependencies {
  readonly settings: SettingsService;
  readonly projects: IProjectRepository;
  readonly context: ProjectContextService;
  readonly launcher: IBrowserLauncher;
  readonly locator: BrowserLocator;
  readonly fileSystem: Pick<IFileSystem, 'exists'>;
  readonly env: NodeJS.ProcessEnv;
  readonly logger: Logger;
}

export class WebChatService {
  private readonly dependencies: WebChatServiceDependencies;

  constructor(dependencies: WebChatServiceDependencies) {
    this.dependencies = dependencies;
  }

  async browsers(): Promise<Result<Awaited<ReturnType<BrowserLocator['list']>>>> {
    const settings = await this.dependencies.settings.get();
    if (!settings.ok) return settings;
    return { ok: true, value: await this.dependencies.locator.list(settings.value.webChat) };
  }

  async open(
    linkId: WebChatLinkId,
  ): Promise<Result<{ readonly opened: true; readonly browser: WebChatSettings['browser'] }>> {
    const settings = await this.dependencies.settings.get();
    if (!settings.ok) return settings;
    const link = settings.value.webChat.links.find((candidate) => candidate.id === linkId);
    if (!link?.enabled) return error(ErrorCode.NOT_FOUND, 'Enabled web chat link was not found.');
    if (!isAllowedWebChatUrl(link.url)) return error(ErrorCode.VALIDATION, 'Saved web chat URL is invalid.');
    let browser = settings.value.webChat.browser;
    if (browser === WebChatBrowser.DEFAULT) {
      browser =
        (await this.dependencies.locator.locate(WebChatBrowser.COCCOC)) !== null
          ? WebChatBrowser.COCCOC
          : WebChatBrowser.DEFAULT;
    }
    let executable = await this.dependencies.locator.locate(browser, settings.value.webChat.customBrowserPath);
    if (browser !== WebChatBrowser.DEFAULT && executable === null) {
      browser = WebChatBrowser.DEFAULT;
      executable = null;
    }
    if (browser === WebChatBrowser.DEFAULT) {
      const windir = this.dependencies.env.WINDIR ?? this.dependencies.env.SystemRoot;
      executable = windir === undefined ? null : join(windir, 'explorer.exe');
      if (executable === null || !(await this.exists(executable)))
        return error(ErrorCode.INTERNAL, 'System browser launcher was not found.');
    }
    if (executable === null || !isAbsolute(executable))
      return error(ErrorCode.INTERNAL, 'Browser executable could not be resolved.');
    const launched = this.dependencies.launcher.launch(executable, link.url);
    if (!launched.ok) {
      this.dependencies.logger.warn({ browser, linkId, error: launched.error.code }, 'Web chat browser launch failed');
      return {
        ok: false,
        error: {
          ...launched.error,
          code: ErrorCode.INTERNAL,
          remediation: ['Choose another browser in Settings → Web chat.'],
        },
      };
    }
    return { ok: true, value: { opened: true, browser } };
  }

  async projectBrief(projectId: ProjectId): Promise<Result<{ readonly text: string }>> {
    const project = await this.dependencies.projects.get(projectId);
    if (project === null) return error(ErrorCode.NOT_FOUND, 'Project was not found.');
    const tree = await this.dependencies.context.buildWebChatTree(project.workspaceRoot);
    const heading = `${project.name}\n\nFolder structure (depth 2):\n`;
    const instruction = '\nMy question: ';
    const text = `${heading}${tree}`.slice(0, 4000 - instruction.length) + instruction;
    return { ok: true, value: { text } };
  }

  private async exists(path: string): Promise<boolean> {
    const result = await this.dependencies.fileSystem.exists(path);
    return result.ok && result.value;
  }
}

function error(code: AppError['code'], message: string): Result<never> {
  return {
    ok: false,
    error: { code, message, remediation: ['Check the web chat settings and try again.'], retryable: false },
  };
}
