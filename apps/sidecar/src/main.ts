import { ProviderId, type ProviderId as ProviderIdType } from '@itstudio/schemas';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROVIDERS: readonly ProviderIdType[] = Object.values(ProviderId);

export function describeSidecar(): string {
  return `itstudio-sidecar skeleton; providers=${String(PROVIDERS.length)}`;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.stderr.write(`${describeSidecar()}\n`);
}
