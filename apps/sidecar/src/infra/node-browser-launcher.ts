import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { ErrorCode, type AppError, type Result } from '@itstudio/schemas';
import type { Logger } from 'pino';
import type { IBrowserLauncher } from '../ports/browser-launcher.js';
import { isAllowedWebChatUrl } from '../domain/web-chat.js';

type SpawnChild = (
  executable: string,
  args: readonly string[],
  options: { readonly shell: false; readonly detached: true; readonly stdio: 'ignore'; readonly windowsHide: false },
) => Pick<ChildProcess, 'on' | 'unref'>;

export class NodeBrowserLauncher implements IBrowserLauncher {
  private readonly logger: Logger;
  private readonly exists: (path: string) => boolean;
  private readonly spawnChild: SpawnChild;

  constructor(
    logger: Logger,
    exists: (path: string) => boolean = existsSync,
    spawnChild: SpawnChild = (executable, args, options) => spawn(executable, [...args], options),
  ) {
    this.logger = logger;
    this.exists = exists;
    this.spawnChild = spawnChild;
  }

  launch(executable: string, url: string): Result<void> {
    if (!isAbsolute(executable) || !executable.toLocaleLowerCase('en-US').endsWith('.exe') || !isAllowedWebChatUrl(url))
      return failure(ErrorCode.VALIDATION, 'Browser executable or URL failed validation.');
    if (!this.exists(executable)) return failure(ErrorCode.VALIDATION, 'Browser executable does not exist.');
    try {
      const child = this.spawnChild(executable, [url], {
        shell: false,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.on('error', (error: Error) => {
        this.logger.warn({ err: error, executable }, 'Browser launch failed');
      });
      child.unref();
      return { ok: true, value: undefined };
    } catch {
      return failure(ErrorCode.INTERNAL, 'Browser could not be launched.');
    }
  }
}

function failure(code: AppError['code'], message: string): Result<never> {
  return {
    ok: false,
    error: { code, message, remediation: ['Choose another browser in Settings → Web chat.'], retryable: false },
  };
}
