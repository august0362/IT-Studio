import { describe, expect, it } from 'vitest';
import { FailureKind, ProviderId } from '@itstudio/schemas';
import type { IHttpClient } from '../../ports/http-client.js';
import { MemorySecretStore } from '../../infra/memory-secret-store.js';
import { imageProviderContract, imageRequest } from '../../infra/__contract__/image-provider-contract.js';
import { FluxReplicateProvider } from './flux-replicate.js';

const predictionUrl = 'https://api.replicate.com/v1/predictions/p-1';
const imageUrl = 'https://cdn.example.test/out.png';
const imageBytes = new Uint8Array([4, 5, 6]);
class FakeHttp implements IHttpClient {
  private readonly respond: (input: string | URL, init?: RequestInit) => Promise<Response>;

  constructor(respond: (input: string | URL, init?: RequestInit) => Promise<Response>) {
    this.respond = respond;
  }
  request(input: string | URL, init?: RequestInit): Promise<Response> {
    return this.respond(input, init);
  }
}
function parseBody(body: RequestInit['body']): unknown {
  if (typeof body !== 'string') throw new Error('Expected a JSON string body.');
  return JSON.parse(body) as unknown;
}

function store(): MemorySecretStore {
  const value = new MemorySecretStore();
  void value.set(ProviderId.REPLICATE, 'fake-replicate-key');
  return value;
}
function happyHttp(): FakeHttp {
  return new FakeHttp(async (input, init) => {
    await Promise.resolve();
    if (init?.method === 'POST') return Response.json({ status: 'processing', urls: { get: predictionUrl } });
    if (String(input) === predictionUrl) return Response.json({ status: 'succeeded', output: [imageUrl] });
    return new Response(imageBytes, { headers: { 'content-type': 'image/png' } });
  });
}

describe('FluxReplicateProvider', () => {
  imageProviderContract(
    'FLUX Replicate',
    () => new FluxReplicateProvider(store(), happyHttp(), { wait: () => Promise.resolve() }),
  );

  it('polls until success and downloads the image immediately', async () => {
    let polls = 0;
    const http = new FakeHttp(async (input, init) => {
      await Promise.resolve();
      if (init?.method === 'POST') {
        expect(parseBody(init.body)).toMatchObject({ input: { prompt: 'blue house', aspect_ratio: '9:16' } });
        return Response.json({ status: 'starting', urls: { get: predictionUrl } });
      }
      if (String(input) === predictionUrl) {
        polls += 1;
        return Response.json(
          polls === 1
            ? { status: 'processing', urls: { get: predictionUrl } }
            : { status: 'succeeded', output: imageUrl },
        );
      }
      return new Response(imageBytes, { headers: { 'content-type': 'image/jpeg' } });
    });
    const result = await new FluxReplicateProvider(store(), http, {
      pollIntervalMs: 1,
      wait: () => Promise.resolve(),
    }).generate({ ...imageRequest, args: { prompt: 'blue house', size: '1024x1792' } }, new AbortController().signal);
    expect(polls).toBe(2);
    expect(result).toMatchObject({ ok: true, value: [{ bytes: imageBytes, mimeType: 'image/jpeg' }] });
  });

  it('returns failure for failed prediction, timeout and cancellation', async () => {
    const failed = new FluxReplicateProvider(
      store(),
      new FakeHttp((input, init) =>
        Promise.resolve(
          init?.method === 'POST'
            ? Response.json({ status: 'starting', urls: { get: predictionUrl } })
            : Response.json({ status: 'failed', error: 'model crashed', urls: { get: predictionUrl } }),
        ),
      ),
      { wait: () => Promise.resolve() },
    );
    expect(await failed.generate(imageRequest, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.SERVER_ERROR },
    });
    const timeout = new FluxReplicateProvider(store(), happyHttp(), { timeoutMs: 0 });
    expect(await timeout.generate(imageRequest, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.TIMEOUT },
    });
    const controller = new AbortController();
    const cancel = new FluxReplicateProvider(store(), happyHttp(), {
      wait: () => {
        controller.abort();
        return Promise.reject(new Error('cancelled'));
      },
    });
    expect(await cancel.generate(imageRequest, controller.signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.TIMEOUT },
    });
  });

  it('classifies request failures and guards malformed and oversized outputs', async () => {
    for (const [status, body, kind] of [
      [429, 'quota billing', FailureKind.QUOTA_EXHAUSTED],
      [429, 'busy', FailureKind.RATE_LIMITED],
      [401, 'no', FailureKind.AUTH],
      [400, 'content_filter safety', FailureKind.CONTENT_FILTERED],
      [422, 'bad', FailureKind.BAD_REQUEST],
      [503, 'down', FailureKind.SERVER_ERROR],
    ] as const) {
      const provider = new FluxReplicateProvider(
        store(),
        new FakeHttp(() => Promise.resolve(new Response(body, { status }))),
      );
      expect(await provider.generate(imageRequest, new AbortController().signal)).toMatchObject({
        ok: false,
        error: { kind },
      });
    }
    const malformed = new FluxReplicateProvider(
      store(),
      new FakeHttp(() => Promise.resolve(Response.json({ status: 'starting' }))),
    );
    expect(await malformed.generate(imageRequest, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.BAD_REQUEST },
    });
    const oversized = new FluxReplicateProvider(
      store(),
      new FakeHttp((input, init) =>
        Promise.resolve(
          init?.method === 'POST'
            ? Response.json({ status: 'succeeded', output: imageUrl, urls: { get: predictionUrl } })
            : new Response(imageBytes, { headers: { 'content-type': 'image/png', 'content-length': '20971521' } }),
        ),
      ),
    );
    expect(await oversized.generate(imageRequest, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.BAD_REQUEST },
    });
  });
  it('handles canceled, empty, filtered, poll and download failures', async () => {
    const canceled = new FluxReplicateProvider(
      store(),
      new FakeHttp((input, init) =>
        Promise.resolve(
          init?.method === 'POST'
            ? Response.json({ status: 'starting', urls: { get: predictionUrl } })
            : Response.json({ status: 'canceled', error: null, urls: { get: predictionUrl } }),
        ),
      ),
      { wait: () => Promise.resolve() },
    );
    expect(await canceled.generate(imageRequest, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.SERVER_ERROR },
    });
    const filtered = new FluxReplicateProvider(
      store(),
      new FakeHttp((input, init) =>
        Promise.resolve(
          init?.method === 'POST'
            ? Response.json({ status: 'starting', urls: { get: predictionUrl } })
            : Response.json({ status: 'failed', error: 'safety content_filter', urls: { get: predictionUrl } }),
        ),
      ),
      { wait: () => Promise.resolve() },
    );
    expect(await filtered.generate(imageRequest, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.CONTENT_FILTERED },
    });
    const empty = new FluxReplicateProvider(
      store(),
      new FakeHttp(() =>
        Promise.resolve(Response.json({ status: 'succeeded', output: null, urls: { get: predictionUrl } })),
      ),
    );
    expect(await empty.generate(imageRequest, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.BAD_REQUEST },
    });
    const unsupported = new FluxReplicateProvider(
      store(),
      new FakeHttp((input, init) =>
        Promise.resolve(
          init?.method === 'POST'
            ? Response.json({ status: 'succeeded', output: imageUrl, urls: { get: predictionUrl } })
            : new Response(imageBytes),
        ),
      ),
    );
    expect(await unsupported.generate(imageRequest, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.BAD_REQUEST },
    });
    const failedPoll = new FluxReplicateProvider(
      store(),
      new FakeHttp((input, init) =>
        Promise.resolve(
          init?.method === 'POST'
            ? Response.json({ status: 'processing', urls: { get: predictionUrl } })
            : new Response('forbidden', { status: 401 }),
        ),
      ),
      { wait: () => Promise.resolve() },
    );
    expect(await failedPoll.generate(imageRequest, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.AUTH },
    });
    const missing = new FluxReplicateProvider(new MemorySecretStore(), happyHttp());
    expect(await missing.generate(imageRequest, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.AUTH },
    });
    const defaultWait = new FluxReplicateProvider(store(), happyHttp(), { pollIntervalMs: 1 });
    expect(await defaultWait.generate(imageRequest, new AbortController().signal)).toMatchObject({ ok: true });
    const controller = new AbortController();
    const abortTimer = setTimeout(() => {
      controller.abort();
    }, 0);
    const abortDuringWait = new FluxReplicateProvider(
      store(),
      new FakeHttp((input, init) =>
        Promise.resolve(
          init?.method === 'POST'
            ? Response.json({ status: 'processing', urls: { get: predictionUrl } })
            : Response.json({ status: 'processing', urls: { get: predictionUrl } }),
        ),
      ),
    );
    expect(await abortDuringWait.generate(imageRequest, controller.signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.TIMEOUT },
    });
    clearTimeout(abortTimer);
  });
});
