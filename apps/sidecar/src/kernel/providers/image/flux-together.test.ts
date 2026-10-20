import { describe, expect, it } from 'vitest';
import { FailureKind, ProviderId } from '@itstudio/schemas';
import type { IHttpClient } from '../../ports/http-client.js';
import { MemorySecretStore } from '../../infra/memory-secret-store.js';
import { imageProviderContract, imageRequest } from '../../infra/__contract__/image-provider-contract.js';
import { FluxTogetherProvider } from './flux-together.js';

const bytes = new Uint8Array([1, 2, 3]);
const url = 'https://cdn.example.test/image.png';
class FakeHttp implements IHttpClient {
  private readonly respond: (input: string | URL, init?: RequestInit) => Promise<Response>;

  constructor(respond: (input: string | URL, init?: RequestInit) => Promise<Response>) {
    this.respond = respond;
  }
  request(input: string | URL, init?: RequestInit): Promise<Response> {
    return this.respond(input, init);
  }
}
const store = async (key: string | null = 'together-test-key'): Promise<MemorySecretStore> => {
  const value = new MemorySecretStore();
  if (key !== null) await value.set(ProviderId.TOGETHER, key);
  return value;
};
const successful = (): FakeHttp =>
  new FakeHttp(async (input) => {
    await Promise.resolve();
    return String(input) === url
      ? new Response(bytes, { headers: { 'content-type': 'image/png' } })
      : Response.json({ data: [{ url }] });
  });

describe('FluxTogetherProvider', () => {
  imageProviderContract('FLUX Together', () => new FluxTogetherProvider(newStore(), successful()));

  it('posts prompt and size, then immediately downloads returned URL bytes', async () => {
    let payload: unknown;
    const http = new FakeHttp(async (input, init) => {
      await Promise.resolve();
      if (String(input) === url) return new Response(bytes, { headers: { 'content-type': 'image/webp' } });
      payload = parseBody(init?.body);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer together-test-key');
      return Response.json({ data: [{ url }] });
    });
    const result = await new FluxTogetherProvider(await store(), http).generate(
      { ...imageRequest, args: { prompt: 'forest', size: '1024x1792' } },
      new AbortController().signal,
    );
    expect(payload).toMatchObject({ prompt: 'forest', width: 1024, height: 1792 });
    expect(result).toMatchObject({ ok: true, value: [{ bytes, mimeType: 'image/webp' }] });
  });

  it('classifies HTTP failures and filters content', async () => {
    for (const [status, body, kind] of [
      [429, 'billing quota exceeded', FailureKind.QUOTA_EXHAUSTED],
      [429, 'busy', FailureKind.RATE_LIMITED],
      [401, 'invalid', FailureKind.AUTH],
      [400, 'safety moderation content_filter', FailureKind.CONTENT_FILTERED],
      [400, 'bad', FailureKind.BAD_REQUEST],
      [503, 'down', FailureKind.SERVER_ERROR],
    ] as const) {
      const provider = new FluxTogetherProvider(
        await store(),
        new FakeHttp(() => Promise.resolve(new Response(body, { status }))),
      );
      const result = await provider.generate(imageRequest, new AbortController().signal);
      expect(result).toMatchObject({ ok: false, error: { kind } });
    }
  });

  it('handles encoded bytes, count, malformed payloads, oversize and missing key', async () => {
    let count = 0;
    const b64 = Buffer.from(bytes).toString('base64');
    const provider = new FluxTogetherProvider(
      await store(),
      new FakeHttp(async (_input, init) => {
        await Promise.resolve();
        count += 1;
        expect(parseBody(init?.body)).toMatchObject({ n: 1 });
        return Response.json({ data: [{ b64_json: b64 }] });
      }),
    );
    const multi = await provider.generate(
      { ...imageRequest, args: { prompt: 'x', count: 2 } },
      new AbortController().signal,
    );
    expect(count).toBe(2);
    if (multi.ok) expect(multi.value).toHaveLength(2);
    const malformed = await new FluxTogetherProvider(
      await store(),
      new FakeHttp(() => Promise.resolve(Response.json({ data: [{}] }))),
    ).generate(imageRequest, new AbortController().signal);
    expect(malformed).toMatchObject({ ok: false, error: { kind: FailureKind.BAD_REQUEST } });
    const oversized = await new FluxTogetherProvider(
      await store(),
      new FakeHttp(async (input) => {
        await Promise.resolve();
        return String(input) === url
          ? new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': '20971521' } })
          : Response.json({ data: [{ url }] });
      }),
    ).generate(imageRequest, new AbortController().signal);
    expect(oversized).toMatchObject({ ok: false, error: { kind: FailureKind.BAD_REQUEST } });
    const absent = await new FluxTogetherProvider(await store(null), successful()).generate(
      imageRequest,
      new AbortController().signal,
    );
    expect(absent).toMatchObject({ ok: false, error: { kind: FailureKind.AUTH } });
    expect(bytes).toBeInstanceOf(Uint8Array);
  });
  it('classifies download failures, unsupported MIME types and aborted provider responses', async () => {
    const jpeg = new FluxTogetherProvider(
      await store(),
      new FakeHttp(async (input) => {
        await Promise.resolve();
        return String(input) === url
          ? new Response(bytes, { headers: { 'content-type': 'image/jpeg; charset=binary' } })
          : Response.json({ data: [{ url }] });
      }),
    );
    expect(await jpeg.generate(imageRequest, new AbortController().signal)).toMatchObject({
      ok: true,
      value: [{ mimeType: 'image/jpeg' }],
    });
    const noMime = new FluxTogetherProvider(
      await store(),
      new FakeHttp(async (input) => {
        await Promise.resolve();
        return String(input) === url ? new Response(bytes) : Response.json({ data: [{ url }] });
      }),
    );
    expect(await noMime.generate(imageRequest, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.BAD_REQUEST },
    });
    const downloadFailure = new FluxTogetherProvider(
      await store(),
      new FakeHttp(async (input) => {
        await Promise.resolve();
        return String(input) === url ? new Response('forbidden', { status: 403 }) : Response.json({ data: [{ url }] });
      }),
    );
    expect(await downloadFailure.generate(imageRequest, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.AUTH },
    });
    const empty = new FluxTogetherProvider(
      await store(),
      new FakeHttp(() => Promise.resolve(Response.json({ data: [] }))),
    );
    expect(await empty.generate(imageRequest, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.BAD_REQUEST },
    });
    const controller = new AbortController();
    controller.abort();
    const aborted = new FluxTogetherProvider(
      await store(),
      new FakeHttp(() => Promise.resolve(new Response('busy', { status: 500 }))),
    );
    expect(await aborted.generate(imageRequest, controller.signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.TIMEOUT },
    });
    const networkFailure = new FluxTogetherProvider(
      await store(),
      new FakeHttp(() => Promise.reject(new Error('offline'))),
    );
    expect(await networkFailure.generate(imageRequest, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { kind: FailureKind.SERVER_ERROR },
    });
  });
  it('rejects oversized encoded and downloaded bodies without relying on headers', async () => {
    const largeB64 = 'A'.repeat(28_000_000);
    const encoded = await new FluxTogetherProvider(
      await store(),
      new FakeHttp(() => Promise.resolve(Response.json({ data: [{ b64_json: largeB64 }] }))),
    ).generate(imageRequest, new AbortController().signal);
    expect(encoded).toMatchObject({ ok: false, error: { kind: FailureKind.BAD_REQUEST } });
    const tooManyBytes = new Uint8Array(20 * 1024 * 1024 + 1);
    const downloaded = await new FluxTogetherProvider(
      await store(),
      new FakeHttp(async (input) => {
        await Promise.resolve();
        return String(input) === url
          ? new Response(tooManyBytes, { headers: { 'content-type': 'image/png' } })
          : Response.json({ data: [{ url }] });
      }),
    ).generate(imageRequest, new AbortController().signal);
    expect(downloaded).toMatchObject({ ok: false, error: { kind: FailureKind.BAD_REQUEST } });
  });
});
function parseBody(body: RequestInit['body']): unknown {
  if (typeof body !== 'string') throw new Error('Expected a JSON string body.');
  return JSON.parse(body) as unknown;
}

function newStore(): MemorySecretStore {
  const value = new MemorySecretStore();
  void value.set(ProviderId.TOGETHER, 'together-test-key');
  return value;
}
