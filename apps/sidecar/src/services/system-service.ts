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
}

export class SystemService {
  private cachedVersion: string | undefined;
  private readonly options: SystemServiceOptions;

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
      this.options.logger.info({ svc: 'sidecar' }, 'shutdown requested');
      setTimeout(() => {
        void this.shutdown();
      }, 0).unref();
      return Promise.resolve({ ok: true, value: { accepted: true } });
    });
  }

  getVersion(): string {
    if (this.cachedVersion === undefined) {
      const packageFile = resolve(import.meta.dirname, '../../package.json');
      const packageJson = JSON.parse(readFileSync(packageFile, 'utf8')) as { readonly version: string };
      this.cachedVersion = packageJson.version;
    }
    return this.cachedVersion;
  }

  private async shutdown(): Promise<void> {
    const exit =
      this.options.exit ??
      ((code: number) => {
        process.exit(code);
      });
    const timeout = setTimeout(() => {
      exit(0);
    }, 5000);
    timeout.unref();
    try {
      for (const hook of this.options.shutdownHooks ?? []) await hook();
    } finally {
      clearTimeout(timeout);
      this.options.logger.info({ svc: 'sidecar', code: 0 }, 'sidecar exiting');
      exit(0);
    }
  }
}
