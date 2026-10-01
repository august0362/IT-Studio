import { ErrorCode, ProviderId } from '@itstudio/schemas';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../infra/clock.js';
import { createLogger } from '../infra/logger.js';
import { MemorySecretStore } from '../infra/memory-secret-store.js';
import type { IProviderKeyVerifier } from '../infra/http/provider-key-verifier.js';
import { SecretsService } from './secrets-service.js';

const noVerify: IProviderKeyVerifier = { verify: () => Promise.resolve({ ok: true, value: undefined }) };

function service(store = new MemorySecretStore(), verifier = noVerify) {
  return {
    store,
    secrets: new SecretsService({ store, verifier, clock: createFakeClock(new Date('2026-10-02T00:00:00.000Z')) }),
  };
}

describe('SecretsService', () => {
  it('trims valid keys and returns only their last four characters', async () => {
    const { secrets, store } = service();
    const result = await secrets.set(ProviderId.OPENAI, '  valid-key-1234  ');
    expect(result).toEqual({ ok: true, value: { provider: 'openai', configured: true, hint: '1234' } });
    expect(await store.get(ProviderId.OPENAI)).toEqual({ ok: true, value: 'valid-key-1234' });
  });

  it.each(['', '   ', 'key with spaces', 'key\nline', 'x'.repeat(513)])(
    'rejects invalid key input without storing it',
    async (key) => {
      const { secrets, store } = service();
      const result = await secrets.set(ProviderId.OPENAI, key);
      expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.VALIDATION } });
      expect(await store.get(ProviderId.OPENAI)).toEqual({ ok: true, value: null });
    },
  );

  it('accepts the 512 character limit', async () => {
    const { secrets } = service();
    expect((await secrets.set(ProviderId.OPENAI, 'k'.repeat(512))).ok).toBe(true);
  });

  it('returns status for every provider and updates verification time only after success', async () => {
    const { secrets } = service();
    await secrets.set(ProviderId.GOOGLE, 'google-key');
    const status = await secrets.status();
    if (!status.ok) throw new Error('Could not read secret status');
    expect(status.value).toHaveLength(7);
    expect(status.value.find((item) => item.provider === ProviderId.GOOGLE)).toEqual({
      provider: ProviderId.GOOGLE,
      configured: true,
      hint: '-key',
    });
    const verified = await secrets.verify(ProviderId.GOOGLE);
    expect(verified).toMatchObject({
      ok: true,
      value: { configured: true, lastVerifiedAt: '2026-10-02T00:00:00.000Z' },
    });
    const removed = await secrets.delete(ProviderId.GOOGLE);
    expect(removed).toEqual({ ok: true, value: { provider: ProviderId.GOOGLE, configured: false } });
  });

  it('does not write key material to logger output or return it from service methods', async () => {
    const secret = 'key-material-that-must-never-leak';
    let logs = '';
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logs += chunk.toString();
        callback();
      },
    });
    const logger = createLogger({ streams: [output], level: 'trace' });
    const { secrets } = service(undefined, { verify: () => Promise.resolve({ ok: true, value: undefined }) });
    const setResult = await secrets.set(ProviderId.OPENAI, secret);
    const verifyResult = await secrets.verify(ProviderId.OPENAI);
    logger.info({ apiKey: secret }, 'secret test');
    logger.flush();
    expect(JSON.stringify([setResult, verifyResult])).not.toContain(secret);
    expect(logs).not.toContain(secret);
  });

  it('does not expose provider error details or key in failures', async () => {
    const secret = 'private-key-value';
    const verifier: IProviderKeyVerifier = {
      verify: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: ErrorCode.PROVIDER_AUTH,
            message: `rejected ${secret}`,
            retryable: false,
            details: { key: secret },
          },
        }),
    };
    const { secrets } = service(undefined, verifier);
    await secrets.set(ProviderId.OPENAI, secret);
    const result = await secrets.verify(ProviderId.OPENAI);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.PROVIDER_AUTH } });
  });
});
