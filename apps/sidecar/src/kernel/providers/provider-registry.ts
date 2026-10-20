import type { ProviderId } from '@itstudio/schemas';
import type { ILlmProvider } from '../ports/llm-provider.js';

export type ProviderFactory = () => ILlmProvider;

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, ILlmProvider>();

  constructor(factories: Partial<Readonly<Record<ProviderId, ProviderFactory>>>) {
    for (const factory of Object.values(factories)) {
      const provider = factory();
      this.providers.set(provider.id, provider);
    }
  }

  get(id: ProviderId): ILlmProvider | undefined {
    return this.providers.get(id);
  }
}
