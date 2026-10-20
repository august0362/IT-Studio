import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FailureKind, type ToolCall } from '@itstudio/schemas';
import type { ProviderRequest } from '../../ports/llm-provider.js';
import { toolCallIdSchema } from '../../validation/brand.js';
import { runProviderContract, type ProviderContractScenario } from '../__contract__/provider-contract.js';
import { jsonFixture, mswServer, stalledResponse } from '../testing/msw-harness.js';
import { GoogleProvider } from './google-provider.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const KEY = 'google-contract-key';
const request: ProviderRequest = {
  modelId: 'test-model',
  system: 'Use concise answers.',
  messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
  maxOutputTokens: 64,
  responseFormat: 'text',
  timeoutMs: 1_000,
};
const fixtureDirectory = new URL('./fixtures/', import.meta.url);
const completionFixture: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL('completion.json', fixtureDirectory)), 'utf8'),
) as unknown;
const streamFixture = readFileSync(fileURLToPath(new URL('stream.sse', fixtureDirectory)), 'utf8');
const toolCall: ToolCall = {
  id: toolCallIdSchema.parse('call_0'),
  name: 'search_knowledge',
  arguments: { query: 'weather' },
};

function configure(scenario: ProviderContractScenario): void {
  mswServer.resetHandlers();
  if (scenario === 'abort' || scenario === 'timeout') {
    mswServer.use(stalledResponse(`${API}/models/test-model:generateContent`));
  } else if (scenario === 'stream') {
    mswServer.use(
      http.post(
        `${API}/models/test-model:streamGenerateContent`,
        () => new HttpResponse(streamFixture, { headers: { 'content-type': 'text/event-stream' } }),
      ),
    );
  } else if (scenario === 'tool_call') {
    mswServer.use(
      jsonFixture(`${API}/models/test-model:generateContent`, {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'search_knowledge', args: { query: 'weather' } } }],
            },
            finishReason: 'STOP',
          },
        ],
        modelVersion: 'test-model',
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
      }),
    );
  } else if (scenario === 'rate_limited') {
    mswServer.use(
      jsonFixture(
        `${API}/models/test-model:generateContent`,
        {
          error: {
            code: 429,
            message: 'Requests per minute exceeded.',
            status: 'RESOURCE_EXHAUSTED',
            details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '2s' }],
          },
        },
        429,
        { 'retry-after': '2' },
      ),
    );
  } else if (scenario === 'quota_exhausted') {
    mswServer.use(
      jsonFixture(
        `${API}/models/test-model:generateContent`,
        { error: { code: 429, message: 'Quota exceeded for quota metric per day.', status: 'RESOURCE_EXHAUSTED' } },
        429,
      ),
    );
  } else if (scenario === 'auth') {
    mswServer.use(
      jsonFixture(
        `${API}/models/test-model:generateContent`,
        { error: { code: 401, message: 'Invalid key.', status: 'UNAUTHENTICATED' } },
        401,
      ),
    );
  } else if (scenario === 'bad_request') {
    mswServer.use(
      jsonFixture(
        `${API}/models/test-model:generateContent`,
        { error: { code: 400, message: 'Invalid request.', status: 'INVALID_ARGUMENT' } },
        400,
      ),
    );
  } else if (scenario === 'complete') {
    mswServer.use(
      http.post(`${API}/models/test-model:generateContent`, ({ request: captured }) => {
        lastApiKey = captured.headers.get('x-goog-api-key');
        return new HttpResponse(JSON.stringify(completionFixture), {
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
  } else {
    const status = scenario === 'server_error_500' ? 500 : 503;
    mswServer.use(
      jsonFixture(
        `${API}/models/test-model:generateContent`,
        { error: { code: status, message: 'Unavailable.', status: status === 500 ? 'INTERNAL' : 'UNAVAILABLE' } },
        status,
      ),
    );
  }
  mswServer.use(jsonFixture(`${API}/models`, { models: [{ name: 'models/test-model' }] }));
}

runProviderContract('GoogleProvider', () => new GoogleProvider(), {
  request,
  apiKey: KEY,
  expectedText: 'contract response',
  expectedToolCall: toolCall,
  configure,
  assertApiKeyHeader: (apiKey) => {
    expect(lastApiKey).toBe(apiKey);
  },
});

let lastApiKey: string | null = null;
describe('GoogleProvider mapping and failures', () => {
  beforeAll(() => {
    mswServer.listen({ onUnhandledRequest: 'error' });
  });
  afterEach(() => {
    mswServer.resetHandlers();
  });
  afterAll(() => {
    mswServer.close();
  });

  it('counts thought tokens as output and maps system, JSON, and API key per call', async () => {
    let sentBody: unknown;
    mswServer.use(
      http.post(`${API}/models/test-model:generateContent`, async ({ request: captured }) => {
        lastApiKey = captured.headers.get('x-goog-api-key');
        sentBody = await captured.json();
        return HttpResponse.json({
          candidates: [{ content: { role: 'model', parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
          modelVersion: 'test-model',
          usageMetadata: {
            promptTokenCount: 9,
            cachedContentTokenCount: 2,
            candidatesTokenCount: 3,
            thoughtsTokenCount: 5,
          },
        });
      }),
    );
    const result = await new GoogleProvider().complete(
      { ...request, responseFormat: 'json' },
      KEY,
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { usage: { inputTokens: 9, cachedInputTokens: 2, outputTokens: 8 } },
    });
    expect(sentBody).toMatchObject({
      systemInstruction: { parts: [{ text: 'Use concise answers.' }] },
      generationConfig: { responseMimeType: 'application/json' },
    });
    expect(lastApiKey).toBe(KEY);
    expect(JSON.stringify(sentBody)).not.toContain(KEY);
  });

  it('parses RetryInfo retryDelay and separates daily quota from rate limits', async () => {
    mswServer.use(
      jsonFixture(
        `${API}/models/test-model:generateContent`,
        {
          error: {
            code: 429,
            message: 'Resource exhausted.',
            status: 'RESOURCE_EXHAUSTED',
            details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' }],
          },
        },
        429,
      ),
    );
    const rate = await new GoogleProvider().complete(request, KEY, new AbortController().signal);
    expect(rate).toMatchObject({ ok: false, error: { kind: FailureKind.RATE_LIMITED, retryAfterMs: 12_000 } });
    mswServer.resetHandlers();
    mswServer.use(
      jsonFixture(
        `${API}/models/test-model:generateContent`,
        {
          error: {
            code: 429,
            message: 'Quota exceeded for quota metric requests per day.',
            status: 'RESOURCE_EXHAUSTED',
          },
        },
        429,
      ),
    );
    const quota = await new GoogleProvider().complete(request, KEY, new AbortController().signal);
    expect(quota).toMatchObject({ ok: false, error: { kind: FailureKind.QUOTA_EXHAUSTED } });
  });

  it('maps prompt blockReason to content_filtered', async () => {
    mswServer.use(
      jsonFixture(`${API}/models/test-model:generateContent`, {
        promptFeedback: { blockReason: 'SAFETY' },
        usageMetadata: { promptTokenCount: 3 },
      }),
    );
    const result = await new GoogleProvider().complete(request, KEY, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { kind: FailureKind.CONTENT_FILTERED } });
  });

  it('maps response safety and token-limit finish reasons', async () => {
    const provider = new GoogleProvider();
    for (const [reason, expected] of [
      ['SAFETY', 'content_filter'],
      ['MAX_TOKENS', 'length'],
    ] as const) {
      mswServer.use(
        jsonFixture(`${API}/models/test-model:generateContent`, {
          candidates: [{ content: { role: 'model', parts: [{ text: 'x' }] }, finishReason: reason }],
          modelVersion: 'test-model',
        }),
      );
      const result = await provider.complete(request, KEY, new AbortController().signal);
      expect(result).toMatchObject({ ok: true, value: { finishReason: expected } });
      mswServer.resetHandlers();
    }
  });
});
