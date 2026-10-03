import OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FailureKind, ProviderId } from '@itstudio/schemas';
import { MemorySecretStore } from '../../infra/memory-secret-store.js';
import { imageProviderContract, imageRequest } from '../../infra/__contract__/image-provider-contract.js';
import type { ISecretStore } from '../../ports/secret-store.js';
import { OpenAiDalle3Provider } from './openai-dalle3.js';

const key = 'fake-openai-image-key';
const secretStore = async (): Promise<MemorySecretStore> => {
  const store = new MemorySecretStore();
  await store.set(ProviderId.OPENAI, key);
  return store;
};
const png = Buffer.from('fake png bytes').toString('base64');

describe('OpenAiDalle3Provider', () => {
  afterEach(() => vi.unstubAllGlobals());
  imageProviderContract(
    'DALL�E 3',
    () => new OpenAiDalle3Provider(newStore(), () => Promise.resolve({ data: [{ b64_json: png }] })),
  );

  it('uses b64_json and makes sequential calls for requested count', async () => {
    let calls = 0;
    const store = await secretStore();
    const provider = new OpenAiDalle3Provider(store, async ({ size }) => {
      calls += 1;
      expect(size).toBe('1792x1024');
      return await Promise.resolve({ data: [{ b64_json: png, revised_prompt: 'revised' }] });
    });
    const result = await provider.generate(
      { ...imageRequest, args: { prompt: 'scene', size: '1792x1024', count: 3 } },
      new AbortController().signal,
    );
    expect(calls).toBe(3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
      expect(result.value[0]).toMatchObject({ mimeType: 'image/png', revisedPrompt: 'revised' });
    }
  });

  it('classifies quota, rate limit, auth, filtered, invalid, server and timeout failures', async () => {
    const store = await secretStore();
    const produce = (error: unknown) =>
      new OpenAiDalle3Provider(store, async () => {
        await Promise.resolve();
        throw error;
      });
    const apiError = (status: number, message: string) =>
      new OpenAI.APIError(status, { message }, message, new Headers());
    const cases: readonly [unknown, FailureKind][] = [
      [apiError(429, 'insufficient_quota'), FailureKind.QUOTA_EXHAUSTED],
      [apiError(429, 'slow down'), FailureKind.RATE_LIMITED],
      [apiError(401, 'denied'), FailureKind.AUTH],
      [apiError(403, 'forbidden'), FailureKind.AUTH],
      [apiError(400, 'content_filter'), FailureKind.CONTENT_FILTERED],
      [apiError(400, 'bad input'), FailureKind.BAD_REQUEST],
      [apiError(503, 'down'), FailureKind.SERVER_ERROR],
      [new OpenAI.APIError(undefined, undefined, 'unknown status', undefined), FailureKind.SERVER_ERROR],
      [new Error('network'), FailureKind.SERVER_ERROR],
      ['non-error throwable', FailureKind.SERVER_ERROR],
      [Object.assign(new Error('timeout'), { name: 'APIConnectionTimeoutError' }), FailureKind.TIMEOUT],
    ];
    for (const [error, kind] of cases) {
      const result = await produce(error).generate(imageRequest, new AbortController().signal);
      expect(result).toMatchObject({ ok: false, error: { kind } });
    }
  });

  it('guards oversized and malformed image responses and missing credentials', async () => {
    const store = await secretStore();
    const tooLarge = 'A'.repeat(28_000_000);
    const oversize = await new OpenAiDalle3Provider(store, () =>
      Promise.resolve({ data: [{ b64_json: tooLarge }] }),
    ).generate(imageRequest, new AbortController().signal);
    expect(oversize).toMatchObject({ ok: false, error: { kind: FailureKind.BAD_REQUEST } });
    const schemaInvalid = await new OpenAiDalle3Provider(store, () => Promise.resolve({ data: 'bad' })).generate(
      imageRequest,
      new AbortController().signal,
    );
    expect(schemaInvalid).toMatchObject({ ok: false, error: { kind: FailureKind.BAD_REQUEST } });
    const malformed = await new OpenAiDalle3Provider(store, () => Promise.resolve({ data: [{}] })).generate(
      imageRequest,
      new AbortController().signal,
    );
    expect(malformed).toMatchObject({ ok: false, error: { kind: FailureKind.BAD_REQUEST } });
    const missing = await new OpenAiDalle3Provider({
      get: () => Promise.resolve({ ok: true, value: null }),
      set: () => Promise.resolve({ ok: true, value: undefined }),
      delete: () => Promise.resolve({ ok: true, value: undefined }),
    }).generate(imageRequest, new AbortController().signal);
    expect(missing).toMatchObject({ ok: false, error: { kind: FailureKind.AUTH } });
  });
  it('uses the OpenAI SDK b64_json request through the secret store', async () => {
    let requestBody: unknown;
    const fakeFetch: typeof fetch = async (_input, init) => {
      await Promise.resolve();
      requestBody = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      return Response.json({ data: [{ b64_json: png }] });
    };
    vi.stubGlobal('fetch', fakeFetch);
    const provider = new OpenAiDalle3Provider(await secretStore());
    const result = await provider.generate(imageRequest, new AbortController().signal);
    expect(requestBody).toMatchObject({
      model: 'dall-e-3',
      prompt: 'a blue house',
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    });
    expect(result.ok).toBe(true);
  });
});

function newStore(): ISecretStore {
  return {
    get: () => Promise.resolve({ ok: true, value: key }),
    set: () => Promise.resolve({ ok: true, value: undefined }),
    delete: () => Promise.resolve({ ok: true, value: undefined }),
  };
}
