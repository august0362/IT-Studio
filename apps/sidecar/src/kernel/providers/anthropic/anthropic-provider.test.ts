import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FailureKind, ProviderId, type ToolCall } from '@itstudio/schemas';
import type { ProviderRequest } from '../../ports/llm-provider.js';
import { imageAssetIdSchema, toolCallIdSchema } from '../../validation/brand.js';
import { runProviderContract, type ProviderContractScenario } from '../__contract__/provider-contract.js';
import { captureRequest, jsonFixture, mswServer, stalledResponse } from '../testing/msw-harness.js';
import { AnthropicProvider } from './anthropic-provider.js';

const API = 'https://api.anthropic.com';
const KEY = 'anthropic-contract-key';
const request: ProviderRequest = {
  modelId: 'claude-test',
  system: 'Use concise answers.',
  messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
  maxOutputTokens: 64,
  responseFormat: 'text',
  timeoutMs: 1_000,
};
const toolCall: ToolCall = {
  id: toolCallIdSchema.parse('00000000-0000-4000-8000-000000000001'),
  name: 'search_knowledge',
  arguments: { query: 'weather' },
};

const events: readonly { readonly type: string; readonly [key: string]: unknown }[] = [
  {
    type: 'message_start',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-test',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 0 },
    },
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'contract ' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'response' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } },
  { type: 'message_stop' },
];

function successBody(
  content: readonly unknown[] = [{ type: 'text', text: 'contract response' }],
  stopReason = 'end_turn',
) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    content,
    model: 'claude-test',
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 3, output_tokens: 4 },
  };
}

function configure(scenario: ProviderContractScenario): void {
  mswServer.resetHandlers();
  if (scenario === 'abort' || scenario === 'timeout') {
    mswServer.use(stalledResponse(`${API}/v1/messages`));
  } else if (scenario === 'stream') {
    mswServer.use(
      http.post(`${API}/v1/messages`, () => {
        const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
        return new HttpResponse(body, { headers: { 'content-type': 'text/event-stream' } });
      }),
    );
  } else if (scenario === 'tool_call') {
    mswServer.use(
      jsonFixture(
        `${API}/v1/messages`,
        successBody(
          [{ type: 'tool_use', id: toolCall.id, name: toolCall.name, input: toolCall.arguments }],
          'tool_use',
        ),
      ),
    );
  } else if (scenario === 'rate_limited') {
    mswServer.use(
      jsonFixture(
        `${API}/v1/messages`,
        { type: 'error', error: { type: 'rate_limit_error', message: 'Slow down.' } },
        429,
        { 'retry-after': '2' },
      ),
    );
  } else if (scenario === 'quota_exhausted') {
    mswServer.use(
      jsonFixture(
        `${API}/v1/messages`,
        { type: 'error', error: { type: 'invalid_request_error', message: 'Credit balance is too low.' } },
        400,
      ),
    );
  } else if (scenario === 'auth') {
    mswServer.use(
      jsonFixture(
        `${API}/v1/messages`,
        { type: 'error', error: { type: 'authentication_error', message: 'Invalid key.' } },
        401,
      ),
    );
  } else if (scenario === 'bad_request') {
    mswServer.use(
      jsonFixture(
        `${API}/v1/messages`,
        { type: 'error', error: { type: 'invalid_request_error', message: 'Invalid request.' } },
        400,
      ),
    );
  } else if (scenario === 'server_error_529') {
    mswServer.use(
      jsonFixture(`${API}/v1/messages`, { type: 'error', error: { type: 'overloaded_error', message: 'Busy.' } }, 529),
    );
  } else if (scenario === 'complete') {
    mswServer.use(
      captureRequest(
        `${API}/v1/messages`,
        ({ request: captured }) => {
          lastHeaders = captured.headers;
        },
        () => HttpResponse.json(successBody()),
      ),
    );
  } else {
    const status = scenario === 'server_error_500' ? 500 : 503;
    mswServer.use(
      jsonFixture(
        `${API}/v1/messages`,
        { type: 'error', error: { type: 'api_error', message: 'Unavailable.' } },
        status,
      ),
    );
  }
  mswServer.use(
    jsonFixture(`${API}/v1/models`, {
      data: [{ id: 'claude-test' }],
      has_more: false,
      first_id: 'claude-test',
      last_id: 'claude-test',
    }),
  );
}

runProviderContract('AnthropicProvider', () => new AnthropicProvider(), {
  request,
  apiKey: KEY,
  expectedText: 'contract response',
  expectedToolCall: toolCall,
  configure,
  assertApiKeyHeader: (apiKey) => {
    expect(lastHeaders.get('x-api-key')).toBe(apiKey);
  },
});

let lastHeaders = new Headers();
describe('AnthropicProvider mapping and failures', () => {
  beforeAll(() => {
    mswServer.listen({ onUnhandledRequest: 'error' });
  });
  afterEach(() => {
    mswServer.resetHandlers();
  });
  afterAll(() => {
    mswServer.close();
  });

  it('maps all reported cache usage fields and refusal finish reason', async () => {
    mswServer.use(
      captureRequest(
        `${API}/v1/messages`,
        ({ request: captured }) => {
          lastHeaders = captured.headers;
        },
        () =>
          HttpResponse.json({
            ...successBody([], 'refusal'),
            usage: { input_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 3, output_tokens: 7 },
          }),
      ),
    );
    const result = await new AnthropicProvider().complete(request, KEY, new AbortController().signal);
    expect(result).toMatchObject({
      ok: true,
      value: { usage: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 7 }, finishReason: 'content_filter' },
    });
  });

  it('maps an image part to bad_request without making a request', async () => {
    const result = await new AnthropicProvider().complete(
      {
        ...request,
        messages: [
          {
            role: 'user',
            parts: [
              {
                type: 'image',
                assetId: imageAssetIdSchema.parse('00000000-0000-4000-8000-000000000001'),
                mimeType: 'image/png',
              },
            ],
          },
        ],
      },
      KEY,
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: false, error: { kind: FailureKind.BAD_REQUEST } });
  });

  it('adds the JSON only system instruction and sends the key in the SDK auth header', async () => {
    let sentBody: unknown;
    mswServer.use(
      http.post(`${API}/v1/messages`, async ({ request: captured }) => {
        lastHeaders = captured.headers;
        sentBody = await captured.json();
        return HttpResponse.json(successBody());
      }),
    );
    await new AnthropicProvider().complete({ ...request, responseFormat: 'json' }, KEY, new AbortController().signal);
    expect(sentBody).toMatchObject({ system: 'Use concise answers.\n\nRespond with a single JSON object only.' });
    expect(lastHeaders.get('x-api-key')).toBe(KEY);
    expect(JSON.stringify(sentBody)).not.toContain(KEY);
  });

  it('classifies 529 overload as server_error', async () => {
    mswServer.use(
      jsonFixture(`${API}/v1/messages`, { type: 'error', error: { type: 'overloaded_error', message: 'busy' } }, 529),
    );
    const result = await new AnthropicProvider().complete(request, KEY, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { kind: FailureKind.SERVER_ERROR } });
    expect(new AnthropicProvider().id).toBe(ProviderId.ANTHROPIC);
  });
});
