import { ProviderId, type ProviderId as ProviderIdType } from '@itstudio/schemas';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSea } from './infra/native-modules.js';

const PROVIDERS: readonly ProviderIdType[] = Object.values(ProviderId);

export function describeSidecar(): string {
  return `itstudio-sidecar; providers=${String(PROVIDERS.length)}`;
}

async function startSidecar(): Promise<void> {
  if (process.env.ITSTUDIO_E2E_CRASH_ON_START === '1') process.exit(1);
  try {
    const { verifyNativeModules } = await import('./infra/native-modules.js');
    verifyNativeModules();
  } catch (error) {
    const missing = error instanceof Error ? error.message : 'Unknown native module load failure';
    process.stderr.write(`${JSON.stringify({ level: 'fatal', svc: 'sidecar', msg: missing })}\n`);
    process.exit(2);
    return;
  }
  const { createContainer } = await import('./container.js');
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
}

if (isSea() || (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])))
  void startSidecar();
