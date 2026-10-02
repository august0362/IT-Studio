import { ProviderId } from '@itstudio/schemas';
import { describe, expect, it } from 'vitest';
import { FakeLlmProvider } from './__contract__/fake-llm-provider.js';
import { ProviderRegistry } from './provider-registry.js';

describe('ProviderRegistry', () => {
  it('creates and returns registered providers while tolerating missing factories', () => {
    const registry = new ProviderRegistry({ [ProviderId.OPENAI]: () => new FakeLlmProvider() });
    expect(registry.get(ProviderId.OPENAI)?.id).toBe(ProviderId.OPENAI);
    expect(registry.get(ProviderId.GOOGLE)).toBeUndefined();
  });
});
