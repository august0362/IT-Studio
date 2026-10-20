import type { ProviderId, Result } from '@itstudio/schemas';
import type { ISecretStore } from '../ports/secret-store.js';

export class MemorySecretStore implements ISecretStore {
  private readonly values = new Map<ProviderId, string>();

  get(provider: ProviderId): Promise<Result<string | null>> {
    return Promise.resolve({ ok: true, value: this.values.get(provider) ?? null });
  }

  set(provider: ProviderId, key: string): Promise<Result<void>> {
    this.values.set(provider, key);
    return Promise.resolve({ ok: true, value: undefined });
  }

  delete(provider: ProviderId): Promise<Result<void>> {
    this.values.delete(provider);
    return Promise.resolve({ ok: true, value: undefined });
  }
}
