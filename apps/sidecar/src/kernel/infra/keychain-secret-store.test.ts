import { ProviderId } from '@itstudio/schemas';
import { describe, expect, it } from 'vitest';
import { KeychainSecretStore } from './keychain-secret-store.js';

const enabled = process.env.ITSTUDIO_KEYCHAIN_TEST === '1';

describe('KeychainSecretStore', () => {
  it.skipIf(!enabled)('stores and removes an OS credential', async () => {
    const store = new KeychainSecretStore();
    const provider = ProviderId.OPENAI;
    const key = `itstudio-keychain-test-${crypto.randomUUID()}`;
    expect(await store.set(provider, key)).toEqual({ ok: true, value: undefined });
    expect(await store.get(provider)).toEqual({ ok: true, value: key });
    expect(await store.delete(provider)).toEqual({ ok: true, value: undefined });
    expect(await store.get(provider)).toEqual({ ok: true, value: null });
  });
});
