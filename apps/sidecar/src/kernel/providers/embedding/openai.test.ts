import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FailureKind } from '@itstudio/schemas';
import { jsonFixture, mswServer, stalledResponse } from '../testing/msw-harness.js';
import { OpenAiEmbeddingProvider } from './openai.js';

const URL = 'https://api.openai.com/v1/embeddings';
const KEY = 'openai-embedding-test-key';
const fixture = (name: string): Record<string, unknown> =>
  z
    .record(z.string(), z.unknown())
    .parse(
      JSON.parse(readFileSync(fileURLToPath(new URLCtor(`./fixtures/${name}`, import.meta.url)), 'utf8')) as unknown,
    );
const URLCtor = globalThis.URL;

describe('OpenAiEmbeddingProvider', () => {
  beforeAll(() => {
    mswServer.listen({ onUnhandledRequest: 'error' });
  });
  afterEach(() => {
    mswServer.resetHandlers();
  });
  afterAll(() => {
    mswServer.close();
  });

  it('maps a successful batch and sends the requested dimensions', async () => {
    let body: unknown;
    mswServer.use(
      http.post(URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(fixture('openai-success.json'));
      }),
    );
    const result = await new OpenAiEmbeddingProvider().embed(
      ['one', 'two'],
      { modelId: 'text-embedding-3-small', dimensions: 2 },
      KEY,
      new AbortController().signal,
    );
    expect(body).toMatchObject({ model: 'text-embedding-3-small', input: ['one', 'two'], dimensions: 2 });
    expect(result).toMatchObject({
      ok: true,
      value: {
        vectors: [
          [3, 4],
          [0, 2],
        ],
        inputTokens: 7,
      },
    });
  });

  it('rejects wrong vector dimensions with a clear bad request failure', async () => {
    mswServer.use(
      jsonFixture(URL, {
        ...fixture('openai-success.json'),
        data: [{ index: 0, embedding: [1] }],
      }),
    );
    const result = await new OpenAiEmbeddingProvider().embed(
      ['one'],
      { modelId: 'm', dimensions: 2 },
      KEY,
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('requested 2');
  });

  it('classifies rate limits and authentication failures without exposing the key', async () => {
    mswServer.use(
      jsonFixture(URL, { error: { message: `invalid ${KEY}`, type: 'rate_limit_error' } }, 429, { 'retry-after': '2' }),
    );
    const rate = await new OpenAiEmbeddingProvider().embed(
      ['one'],
      { modelId: 'm', dimensions: 2 },
      KEY,
      new AbortController().signal,
    );
    expect(rate).toMatchObject({ ok: false, error: { kind: FailureKind.RATE_LIMITED, retryAfterMs: 2000 } });
    expect(JSON.stringify(rate)).not.toContain(KEY);
    mswServer.use(jsonFixture(URL, { error: { message: `invalid ${KEY}` } }, 401));
    const auth = await new OpenAiEmbeddingProvider().embed(
      ['one'],
      { modelId: 'm', dimensions: 2 },
      KEY,
      new AbortController().signal,
    );
    expect(auth).toMatchObject({ ok: false, error: { kind: FailureKind.AUTH } });
    expect(JSON.stringify(auth)).not.toContain(KEY);
  });

  it('classifies quota, server errors, and SDK timeouts', async () => {
    mswServer.use(jsonFixture(URL, { error: { message: 'Billing quota exceeded', code: 'insufficient_quota' } }, 429));
    const quota = await new OpenAiEmbeddingProvider().embed(
      ['text'],
      { modelId: 'm', dimensions: 2 },
      KEY,
      new AbortController().signal,
    );
    expect(quota).toMatchObject({ ok: false, error: { kind: FailureKind.QUOTA_EXHAUSTED } });

    mswServer.use(jsonFixture(URL, { error: { message: 'temporarily unavailable' } }, 503));
    const server = await new OpenAiEmbeddingProvider().embed(
      ['text'],
      { modelId: 'm', dimensions: 2 },
      KEY,
      new AbortController().signal,
    );
    expect(server).toMatchObject({ ok: false, error: { kind: FailureKind.SERVER_ERROR } });

    mswServer.use(stalledResponse(URL));
    const timeout = await new OpenAiEmbeddingProvider(10).embed(
      ['text'],
      { modelId: 'm', dimensions: 2 },
      KEY,
      new AbortController().signal,
    );
    expect(timeout).toMatchObject({ ok: false, error: { kind: FailureKind.TIMEOUT } });
  });
});
