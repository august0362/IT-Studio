import type { ModelCapability, ModelDescriptor, ModelKey, ProviderId } from '@itstudio/schemas';
import type { ProviderRegistry } from '../providers/provider-registry.js';

export type EligibilityReason = 'disabled' | 'no_secret' | 'capability' | 'adapter_unavailable' | 'unknown_model';

export class ModelRegistry {
  private readonly models: readonly ModelDescriptor[];
  private readonly byKey: ReadonlyMap<ModelKey, ModelDescriptor>;
  private readonly adapterUnavailable: ReadonlySet<ModelKey>;
  private readonly providers: ProviderRegistry;

  constructor(models: readonly ModelDescriptor[], providers: ProviderRegistry) {
    this.models = [...models];
    this.byKey = new Map(models.map((model) => [model.key, model]));
    this.providers = providers;
    this.adapterUnavailable = new Set(
      models.filter((model) => providers.get(model.provider) === undefined).map((model) => model.key),
    );
  }

  list(): readonly ModelDescriptor[] {
    return this.models;
  }

  get(key: ModelKey): ModelDescriptor | undefined {
    return this.byKey.get(key);
  }

  supports(key: ModelKey, caps: readonly ModelCapability[]): boolean {
    const model = this.get(key);
    return model !== undefined && caps.every((capability) => model.capabilities.includes(capability));
  }

  eligibility(
    key: ModelKey,
    required: readonly ModelCapability[],
    hasSecret: (provider: ProviderId) => boolean,
  ): { readonly eligible: boolean; readonly reason?: EligibilityReason } {
    const model = this.get(key);
    if (model === undefined) return { eligible: false, reason: 'unknown_model' };
    if (this.adapterUnavailable.has(key)) return { eligible: false, reason: 'adapter_unavailable' };
    if (!model.enabled) return { eligible: false, reason: 'disabled' };
    if (!this.supports(key, required)) return { eligible: false, reason: 'capability' };
    if (!hasSecret(model.provider)) return { eligible: false, reason: 'no_secret' };
    return { eligible: true };
  }

  async verifyModelIds(
    provider: ProviderId,
    apiKey: string,
  ): Promise<{ readonly known: string[]; readonly missing: string[] }> {
    const adapter = this.providers.get(provider);
    const seedIds = this.models.filter((model) => model.provider === provider).map((model) => model.providerModelId);
    if (adapter === undefined) return { known: [], missing: seedIds };
    const listed = await adapter.listModels(apiKey, new AbortController().signal);
    if (!listed.ok) return { known: [], missing: seedIds };
    const available = new Set(listed.value);
    const known = seedIds.filter((id) => available.has(id));
    const missing = seedIds.filter((id) => !available.has(id));
    return { known, missing };
  }
}
