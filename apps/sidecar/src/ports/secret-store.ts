import type { ProviderId, Result } from '@itstudio/schemas';

export interface ISecretStore {
  get(provider: ProviderId): Promise<Result<string | null>>;
  set(provider: ProviderId, key: string): Promise<Result<void>>;
  delete(provider: ProviderId): Promise<Result<void>>;
}
