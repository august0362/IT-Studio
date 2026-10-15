import { createProcessProbe } from './process-test-helper.js';
import type { IProcessTracker } from '../ports/process-tracker.js';
import { ErrorCode, ProviderId, type ProviderId as Provider } from '@itstudio/schemas';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createFakeClock } from '../infra/clock.js';
import { createLogger } from '../infra/logger.js';
import { MemorySecretStore } from '../infra/memory-secret-store.js';
import type { IProviderKeyVerifier } from '../infra/http/provider-key-verifier.js';
import type { ISecretHistoryRepository } from '../infra/sqlite/secret-history-repository.js';
import type { SecretHistoryEntry } from '@itstudio/schemas';
import { SecretsService } from './secrets-service.js';

const noVerify: IProviderKeyVerifier = { verify: () => Promise.resolve({ ok: true, value: undefined }) };

class MemorySecretHistory implements ISecretHistoryRepository {
  readonly entries: SecretHistoryEntry[] = [];
  failWrites = false;

  append(entry: SecretHistoryEntry): void {
    if (this.failWrites) throw new Error('database unavailable');
    this.entries.unshift(entry);
  }

  list(provider: SecretHistoryEntry['provider'] | undefined, limit: number): readonly SecretHistoryEntry[] {
    return this.entries.filter((entry) => provider === undefined || entry.provider === provider).slice(0, limit);
  }
}

function service(store = new MemorySecretStore(), verifier = noVerify, processes?: IProcessTracker) {
  const history = new MemorySecretHistory();
  return {
    store,
    history,
    secrets: new SecretsService({
      ...(processes === undefined ? {} : { processes }),
      store,
      verifier,
      history,
      ids: { uuid: randomUUID },
      clock: createFakeClock(new Date('2026-10-02T00:00:00.000Z')),
    }),
  };
}

describe('SecretsService', () => {
  it('PROC-01 cancellation aborts verification and prevents saving a candidate key', async () => {
    const probe = createProcessProbe();
    const verifier: IProviderKeyVerifier = {
      verify: (_provider, _key, signal) =>
        new Promise((resolveVerified) => {
          signal?.addEventListener(
            'abort',
            () => {
              resolveVerified({ ok: true, value: undefined });
            },
            { once: true },
          );
        }),
    };
    const h = service(new MemorySecretStore(), verifier, probe.tracker);
    const pending = h.secrets.verifyAndSave(ProviderId.OPENAI, 'candidate-test-key');
    await vi.waitFor(() => {
      expect(probe.start).toHaveBeenCalledOnce();
    });
    const init = probe.start.mock.calls[0]?.[1];
    await init?.cancel?.();
    expect(await pending).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(await h.store.get(ProviderId.OPENAI)).toEqual({ ok: true, value: null });
    expect(probe.end).not.toHaveBeenCalled();
  });

  it('PROC-01 instruments verification using only provider and a masked suffix', async () => {
    const probe = createProcessProbe();
    const h = service(new MemorySecretStore(), noVerify, probe.tracker);
    await h.secrets.set(ProviderId.OPENAI, 'private-test-value-1234');
    await h.secrets.verify(ProviderId.OPENAI);
    expect(probe.start).toHaveBeenCalledWith(
      'key_verify',
      expect.objectContaining({ operation: { kind: 'key_verify', params: { provider: 'openai' } } }),
    );
    expect(probe.module).toHaveBeenCalledWith(expect.anything(), 'input', {
      state: 'done',
      output: 'Key ending in ****1234',
    });
    expect(JSON.stringify(probe.module.mock.calls)).not.toContain('private-test-value');
    expect(probe.end).toHaveBeenCalledWith(expect.anything(), 'Key verified');
  });
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
    expect(status.value).toHaveLength(11);
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

  it('restores the existing key and verification time if deletion history cannot be written', async () => {
    const store = new MemorySecretStore();
    await store.set(ProviderId.GOOGLE, 'google-secret-1234');
    const secrets = new SecretsService({
      store,
      verifier: noVerify,
      history: {
        append: () => {
          throw new Error('database unavailable');
        },
        list: () => [],
      },
      ids: { uuid: randomUUID },
      clock: createFakeClock(new Date('2026-10-02T00:00:00.000Z')),
    });
    await secrets.verify(ProviderId.GOOGLE);

    const removed = await secrets.delete(ProviderId.GOOGLE);

    expect(removed).toMatchObject({ ok: false, error: { code: ErrorCode.INTERNAL } });
    expect(await store.get(ProviderId.GOOGLE)).toEqual({ ok: true, value: 'google-secret-1234' });
    const status = await secrets.status();
    if (!status.ok) throw new Error('Could not read secret status');
    expect(status.value.find((item) => item.provider === ProviderId.GOOGLE)).toEqual({
      provider: ProviderId.GOOGLE,
      configured: true,
      hint: '1234',
      lastVerifiedAt: '2026-10-02T00:00:00.000Z',
    });
  });

  it('restores the previous verified key if saving history fails', async () => {
    const { secrets, store, history } = service();
    await secrets.verifyAndSave(ProviderId.OPENAI, 'previous-secret-1111');
    history.failWrites = true;

    const result = await secrets.verifyAndSave(ProviderId.OPENAI, 'candidate-secret-9876');

    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.INTERNAL } });
    expect(await store.get(ProviderId.OPENAI)).toEqual({ ok: true, value: 'previous-secret-1111' });
    const status = await secrets.status();
    if (!status.ok) throw new Error('Could not read secret status');
    expect(status.value.find((item) => item.provider === ProviderId.OPENAI)).toMatchObject({
      hint: '1111',
      lastVerifiedAt: '2026-10-02T00:00:00.000Z',
    });
    expect(history.entries).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('candidate-secret-9876');
  });

  it.each(['result', 'throw'] as const)(
    'reports failed key restoration (%s) and clears stale verification',
    async (mode) => {
      const { secrets, store, history } = service();
      await secrets.verifyAndSave(ProviderId.OPENAI, 'previous-secret-1111');
      history.failWrites = true;
      const originalSet = store.set.bind(store);
      vi.spyOn(store, 'set').mockImplementation((provider, key) => {
        if (key !== 'previous-secret-1111') return originalSet(provider, key);
        if (mode === 'throw') return Promise.reject(new Error(`cannot restore ${key}`));
        return Promise.resolve({
          ok: false,
          error: { code: ErrorCode.INTERNAL, message: `cannot restore ${key}`, retryable: true },
        });
      });

      const result = await secrets.verifyAndSave(ProviderId.OPENAI, 'candidate-secret-9876');

      expect(result).toMatchObject({
        ok: false,
        error: { code: ErrorCode.INTERNAL, details: { keyStateMayHaveChanged: true } },
      });
      expect(await store.get(ProviderId.OPENAI)).toEqual({ ok: true, value: 'candidate-secret-9876' });
      const status = await secrets.status();
      if (!status.ok) throw new Error('Could not read secret status');
      expect(status.value.find((item) => item.provider === ProviderId.OPENAI)).toEqual({
        provider: ProviderId.OPENAI,
        configured: true,
        hint: '9876',
      });
      expect(JSON.stringify(result)).not.toContain('previous-secret-1111');
      expect(JSON.stringify(result)).not.toContain('candidate-secret-9876');
    },
  );

  it('reports failed rollback of a first saved key when history is unavailable', async () => {
    const { secrets, store, history } = service();
    history.failWrites = true;
    vi.spyOn(store, 'delete').mockResolvedValue({
      ok: false,
      error: { code: ErrorCode.INTERNAL, message: 'credential store unavailable', retryable: true },
    });

    const result = await secrets.verifyAndSave(ProviderId.OPENAI, 'candidate-secret-9876');

    expect(result).toMatchObject({ ok: false, error: { details: { keyStateMayHaveChanged: true } } });
    expect(await store.get(ProviderId.OPENAI)).toEqual({ ok: true, value: 'candidate-secret-9876' });
    expect(history.entries).toHaveLength(0);
  });

  it('reports failed restoration after deletion and clears stale verification', async () => {
    const { secrets, store, history } = service();
    await secrets.verifyAndSave(ProviderId.OPENAI, 'previous-secret-1111');
    history.failWrites = true;
    vi.spyOn(store, 'set').mockRejectedValue(new Error('credential store unavailable'));

    const result = await secrets.delete(ProviderId.OPENAI);

    expect(result).toMatchObject({ ok: false, error: { details: { keyStateMayHaveChanged: true } } });
    const status = await secrets.status();
    if (!status.ok) throw new Error('Could not read secret status');
    expect(status.value.find((item) => item.provider === ProviderId.OPENAI)).toEqual({
      provider: ProviderId.OPENAI,
      configured: false,
    });
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

  it('verifies a candidate before storing it and records only a masked history entry', async () => {
    const events: string[] = [];
    class OrderedStore extends MemorySecretStore {
      override set(provider: Provider, key: string) {
        events.push('store');
        return super.set(provider, key);
      }
    }
    const store = new OrderedStore();
    const verifier: IProviderKeyVerifier = {
      verify: async (_provider, key) => {
        events.push(`verify:${key}`);
        expect(await store.get(ProviderId.OPENAI)).toEqual({ ok: true, value: null });
        return { ok: true, value: undefined };
      },
    };
    const { secrets, history } = service(store, verifier);
    const result = await secrets.verifyAndSave(ProviderId.OPENAI, 'candidate-secret-9876');
    expect(result).toMatchObject({ ok: true, value: { configured: true, hint: '9876' } });
    expect(events).toEqual(['verify:candidate-secret-9876', 'store']);
    expect(await store.get(ProviderId.OPENAI)).toEqual({ ok: true, value: 'candidate-secret-9876' });
    expect(history.entries[0]).toMatchObject({ action: 'saved', provider: 'openai', hint: '9876', resultCode: null });
    expect(JSON.stringify(history.entries)).not.toContain('candidate-secret-9876');
  });

  it('keeps the previous key when candidate verification fails', async () => {
    const store = new MemorySecretStore();
    await store.set(ProviderId.OPENAI, 'previous-secret-1111');
    const verifier: IProviderKeyVerifier = {
      verify: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: ErrorCode.PROVIDER_AUTH,
            message: 'The provider rejected this key.',
            remediation: ['The provider rejected this key.'],
            retryable: false,
          },
        }),
    };
    const { secrets, history } = service(store, verifier);
    const result = await secrets.verifyAndSave(ProviderId.OPENAI, 'candidate-secret-9876');
    expect(result).toMatchObject({
      ok: false,
      error: { code: ErrorCode.PROVIDER_AUTH, remediation: ['The provider rejected this key.'] },
    });
    expect(await store.get(ProviderId.OPENAI)).toEqual({ ok: true, value: 'previous-secret-1111' });
    expect(history.entries[0]).toMatchObject({
      action: 'verify_failed',
      hint: '9876',
      resultCode: ErrorCode.PROVIDER_AUTH,
    });
    expect(JSON.stringify(history.entries)).not.toContain('candidate-secret-9876');
  });

  it('returns a filtered and limited secret history', async () => {
    const { secrets, history } = service();
    await secrets.verifyAndSave(ProviderId.GOOGLE, 'google-key-1234');
    await secrets.verifyAndSave(ProviderId.OPENAI, 'openai-key-5678');
    expect(secrets.history('google', 1)).toMatchObject({ ok: true, value: [{ provider: 'google', hint: '1234' }] });
    expect(history.entries).toHaveLength(2);
    expect(secrets.history(undefined, 51)).toMatchObject({ ok: false, error: { code: ErrorCode.VALIDATION } });
  });
});
