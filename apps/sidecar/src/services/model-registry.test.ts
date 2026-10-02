import { ModelCapability, ProviderId, type ModelDescriptor } from '@itstudio/schemas';
import { describe, expect, it } from 'vitest';
import { FakeLlmProvider } from '../providers/__contract__/fake-llm-provider.js';
import { ProviderRegistry } from '../providers/provider-registry.js';
import { ModelRegistry } from './model-registry.js';

const models: readonly ModelDescriptor[] = [
  {
    key: 'openai/model-a',
    provider: ProviderId.OPENAI,
    providerModelId: 'model-a',
    displayName: 'A',
    capabilities: [ModelCapability.CHAT],
    contextWindowTokens: 100,
    maxOutputTokens: 20,
    enabled: true,
  },
  {
    key: 'openai/model-disabled',
    provider: ProviderId.OPENAI,
    providerModelId: 'model-disabled',
    displayName: 'Disabled',
    capabilities: [ModelCapability.CHAT],
    contextWindowTokens: 100,
    maxOutputTokens: 20,
    enabled: false,
  },
  {
    key: 'google/model-g',
    provider: ProviderId.GOOGLE,
    providerModelId: 'model-g',
    displayName: 'G',
    capabilities: [ModelCapability.CHAT],
    contextWindowTokens: 100,
    maxOutputTokens: 20,
    enabled: true,
  },
];

describe('ModelRegistry', () => {
  const registry = new ModelRegistry(
    models,
    new ProviderRegistry({
      [ProviderId.OPENAI]: () => new FakeLlmProvider({ models: { ok: true, value: ['model-a'] } }),
    }),
  );

  it('reports eligibility failure reasons and capability support', () => {
    expect(registry.eligibility('replicate/missing-model', [], () => true).reason).toBe('unknown_model');
    expect(registry.eligibility('google/model-g', [], () => true).reason).toBe('adapter_unavailable');
    expect(registry.eligibility('openai/model-disabled', [], () => true).reason).toBe('disabled');
    expect(registry.eligibility('openai/model-a', [ModelCapability.VISION], () => true).reason).toBe('capability');
    expect(registry.eligibility('openai/model-a', [], () => false).reason).toBe('no_secret');
    expect(registry.eligibility('openai/model-a', [ModelCapability.CHAT], () => true)).toEqual({ eligible: true });
    expect(registry.supports('openai/model-a', [ModelCapability.CHAT])).toBe(true);
    expect(registry.supports('openai/model-a', [ModelCapability.VISION])).toBe(false);
  });

  it('verifies seed provider model ids against a provider listing', async () => {
    await expect(registry.verifyModelIds(ProviderId.OPENAI, 'unused')).resolves.toEqual({
      known: ['model-a'],
      missing: ['model-disabled'],
    });
    await expect(registry.verifyModelIds(ProviderId.GOOGLE, 'unused')).resolves.toEqual({
      known: [],
      missing: ['model-g'],
    });
  });
});
