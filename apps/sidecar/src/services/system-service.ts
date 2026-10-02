import type { RpcMethodMap, Result } from '@itstudio/schemas';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IClock } from '../infra/clock.js';
import type { RpcServer } from '../rpc/rpc-server.js';
import type { Logger } from 'pino';

export interface SystemServiceOptions {
  readonly clock: IClock;
  readonly startedAt: number;
  readonly logger: Logger;
  readonly exit?: (code: number) => void;
  readonly shutdownHooks?: readonly (() => void | Promise<void>)[];
  readonly timers?: SystemServiceTimers;
}

export interface SystemServiceTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemTimers: SystemServiceTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

export class SystemService {
  private cachedVersion: string | undefined;
  private readonly options: SystemServiceOptions;
  private shutdownPromise: Promise<void> | undefined;

  constructor(options: SystemServiceOptions) {
    this.options = options;
  }

  register(server: RpcServer): void {
    server.register('system.ping', (): Promise<Result<RpcMethodMap['system.ping']['result']>> =>
      Promise.resolve({
        ok: true,
        value: {
          version: this.getVersion(),
          uptimeMs: Math.max(0, this.options.clock.monotonicMs() - this.options.startedAt),
        },
      }),
    );
    server.register('system.shutdown', (): Promise<Result<RpcMethodMap['system.shutdown']['result']>> => {
      setTimeout(() => {
        void this.shutdown('rpc');
      }, 0).unref();
      return Promise.resolve({ ok: true, value: { accepted: true } });
    });
  }

  shutdown(reason: 'rpc' | 'stdin_closed'): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    this.options.logger.info({ svc: 'sidecar', reason }, 'shutdown requested');
    this.shutdownPromise = Promise.resolve().then(() => this.runShutdown());
    return this.shutdownPromise;
  }

  getVersion(): string {
    if (this.cachedVersion === undefined) {
      const packageFile = resolve(import.meta.dirname, '../../package.json');
      const packageJson = JSON.parse(readFileSync(packageFile, 'utf8')) as { readonly version: string };
      this.cachedVersion = packageJson.version;
    }
    return this.cachedVersion;
  }

  private async runShutdown(): Promise<void> {
    const timers = this.options.timers ?? systemTimers;
    const exit =
      this.options.exit ??
      ((code: number) => {
        process.exit(code);
      });
    let timeout: unknown;
    const deadline = new Promise<void>((resolve) => {
      timeout = timers.setTimeout(() => {
        this.options.logger.warn({ svc: 'sidecar', timeoutMs: 3000 }, 'shutdown deadline reached; forcing exit');
        this.options.logger.info({ svc: 'sidecar', code: 0 }, 'sidecar exiting');
        exit(0);
        resolve();
      }, 3000);
    });
    const hooks = Promise.all(
      (this.options.shutdownHooks ?? []).map(async (hook, index) => {
        try {
          await hook();
        } catch (error) {
          this.options.logger.error(
            { svc: 'sidecar', hookIndex: index, error: error instanceof Error ? error.message : 'unknown' },
            'shutdown hook failed',
          );
        }
      }),
    );
    const outcome = await Promise.race([hooks.then(() => 'hooks' as const), deadline.then(() => 'deadline' as const)]);
    if (timeout !== undefined) timers.clearTimeout(timeout);
    if (outcome === 'deadline') return;
    this.options.logger.info({ svc: 'sidecar', code: 0 }, 'sidecar exiting');
    exit(0);
  }
}
