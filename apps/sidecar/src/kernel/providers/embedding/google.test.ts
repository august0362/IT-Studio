import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FailureKind } from '@itstudio/schemas';
import { jsonFixture, mswServer, stalledResponse } from '../testing/msw-harness.js';
import { GoogleEmbeddingProvider } from './google.js';

const ENDPOINT =
  /https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/(?:models\/)?[^/:]+:(?:embedContent|batchEmbedContents)$/;
const KEY = 'google-embedding-test-key';
const fixture = (name: string): Record<string, unknown> =>
  z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')) as unknown);

describe('GoogleEmbeddingProvider', () => {
  beforeAll(() => {
    mswServer.listen({ onUnhandledRequest: 'error' });
    return import('@google/genai').then(() => undefined);
  });
  afterEach(() => {
    mswServer.resetHandlers();
  });
  afterAll(() => {
    mswServer.close();
  });

  it('maps a successful batch and requests the output dimensionality', async () => {
    let body: unknown;
    mswServer.use(
      http.post(ENDPOINT, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(fixture('google-success.json'));
      }),
    );
    const result = await new GoogleEmbeddingProvider().embed(
      ['one', 'two'],
      { modelId: 'gemini-embedding-2', dimensions: 2 },
      KEY,
      new AbortController().signal,
    );
    expect(body).toMatchObject({
      requests: [
        {
          model: 'models/gemini-embedding-2',
          content: { parts: [{ text: 'one' }, { text: 'two' }] },
          outputDimensionality: 2,
        },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        vectors: [
          [3, 4],
          [0, 2],
        ],
        inputTokens: 2,
      },
    });
  });

  it('rejects malformed dimensions and classifies rate limit and auth errors', async () => {
    mswServer.use(jsonFixture(ENDPOINT, { embeddings: [{ values: [1] }] }));
    const wrong = await new GoogleEmbeddingProvider().embed(
      ['one'],
      { modelId: 'm', dimensions: 2 },
      KEY,
      new AbortController().signal,
    );
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.message).toContain('requested 2');
    mswServer.use(
      jsonFixture(ENDPOINT, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: `limit ${KEY}` } }, 429),
    );
    const rate = await new GoogleEmbeddingProvider().embed(
      ['one'],
      { modelId: 'm', dimensions: 2 },
      KEY,
      new AbortController().signal,
    );
    expect(rate).toMatchObject({ ok: false, error: { kind: FailureKind.RATE_LIMITED } });
    expect(JSON.stringify(rate)).not.toContain(KEY);
    mswServer.use(
      jsonFixture(ENDPOINT, { error: { code: 401, status: 'UNAUTHENTICATED', message: `auth ${KEY}` } }, 401),
    );
    const auth = await new GoogleEmbeddingProvider().embed(
      ['one'],
      { modelId: 'm', dimensions: 2 },
      KEY,
      new AbortController().signal,
    );
    expect(auth).toMatchObject({ ok: false, error: { kind: FailureKind.AUTH } });
    expect(JSON.stringify(auth)).not.toContain(KEY);
  });

  it('classifies daily quota, server errors, and SDK timeouts', async () => {
    mswServer.use(
      jsonFixture(
        ENDPOINT,
        {
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            message: 'Quota exceeded for quota metric per day',
          },
        },
        429,
      ),
    );
    const quota = await new GoogleEmbeddingProvider().embed(
      ['text'],
      { modelId: 'm', dimensions: 2 },
      KEY,
      new AbortController().signal,
    );
    expect(quota).toMatchObject({ ok: false, error: { kind: FailureKind.QUOTA_EXHAUSTED } });

    mswServer.use(
      jsonFixture(ENDPOINT, { error: { code: 503, status: 'UNAVAILABLE', message: 'server unavailable' } }, 503),
    );
    const server = await new GoogleEmbeddingProvider().embed(
      ['text'],
      { modelId: 'm', dimensions: 2 },
      KEY,
      new AbortController().signal,
    );
    expect(server).toMatchObject({ ok: false, error: { kind: FailureKind.SERVER_ERROR } });

    mswServer.use(stalledResponse(ENDPOINT));
    const timeout = await new GoogleEmbeddingProvider(10).embed(
      ['text'],
      { modelId: 'm', dimensions: 2 },
      KEY,
      new AbortController().signal,
    );
    expect(timeout).toMatchObject({ ok: false, error: { kind: FailureKind.TIMEOUT } });
  });
});
