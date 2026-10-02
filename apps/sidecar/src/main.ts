import { ProviderId, type ProviderId as ProviderIdType } from '@itstudio/schemas';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContainer } from './container.js';

const PROVIDERS: readonly ProviderIdType[] = Object.values(ProviderId);

export function describeSidecar(): string {
  return `itstudio-sidecar; providers=${String(PROVIDERS.length)}`;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const container = createContainer(process.env);
  process.on('unhandledRejection', (reason: unknown) => {
    container.logger.error({ svc: 'sidecar', err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error: Error) => {
    container.logger.fatal({ svc: 'sidecar', err: error }, 'Uncaught exception');
    container.logger.info({ svc: 'sidecar', code: 1 }, 'sidecar exiting');
    process.exit(1);
  });
  container.start();
  if (process.env.ITSTUDIO_E2E_CRASH_ON_START === '1') process.exit(1);
}
