import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FailureKind, ProviderId, type ToolCall } from '@itstudio/schemas';
import type { ProviderRequest } from '../../ports/llm-provider.js';
import { toolCallIdSchema } from '../../validation/brand.js';
import { runProviderContract, type ProviderContractScenario } from '../__contract__/provider-contract.js';
import { jsonFixture, mswServer, stalledResponse } from '../testing/msw-harness.js';
import { OPENAI_COMPATIBLE_BASE_URLS, OpenAiCompatibleProvider } from './openai-compatible-provider.js';

const KEY = 'openai-compatible-test-key';
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
  id: toolCallIdSchema.parse('00000000-0000-4000-8000-000000000001'),
  name: 'search_knowledge',
  arguments: { query: 'weather' },
};

type CompatibleProviderId =
  typeof ProviderId.OPENAI | typeof ProviderId.XAI | typeof ProviderId.GROQ | typeof ProviderId.TOGETHER;

function configure(id: CompatibleProviderId, scenario: ProviderContractScenario): void {
  const url = `${OPENAI_COMPATIBLE_BASE_URLS[id]}/chat/completions`;
  mswServer.resetHandlers();
  if (scenario === 'abort' || scenario === 'timeout') {
    mswServer.use(stalledResponse(url));
  } else if (scenario === 'stream') {
    mswServer.use(
      http.post(
        url,
        () =>
          new HttpResponse(new TextEncoder().encode(streamFixture), {
            headers: { 'content-type': 'text/event-stream' },
          }),
      ),
    );
  } else if (scenario === 'tool_call') {
    mswServer.use(jsonFixture(url, completionWithToolCall()));
  } else if (scenario === 'rate_limited') {
    mswServer.use(
      jsonFixture(url, { error: { message: 'Rate limit reached.', type: 'rate_limit_error' } }, 429, {
        'retry-after': '2',
      }),
    );
  } else if (scenario === 'quota_exhausted') {
    mswServer.use(
      jsonFixture(
        url,
        { error: { message: 'Quota billing limit exceeded.', type: 'insufficient_quota', code: 'insufficient_quota' } },
        429,
      ),
    );
  } else if (scenario === 'auth') {
    mswServer.use(jsonFixture(url, { error: { message: 'Invalid key.', type: 'authentication_error' } }, 401));
  } else if (scenario === 'bad_request') {
    mswServer.use(jsonFixture(url, { error: { message: 'Invalid request.', type: 'invalid_request_error' } }, 400));
  } else if (scenario === 'server_error_529') {
    mswServer.use(jsonFixture(url, { error: { message: 'Busy.', type: 'server_error' } }, 529));
  } else if (scenario === 'complete') {
    mswServer.use(jsonFixture(url, completionFixture));
  } else {
    const status = scenario === 'server_error_500' ? 500 : 503;
    mswServer.use(jsonFixture(url, { error: { message: 'Unavailable.', type: 'server_error' } }, status));
  }
  mswServer.use(
    jsonFixture(`${OPENAI_COMPATIBLE_BASE_URLS[id]}/models`, {
      object: 'list',
      data: [{ id: 'test-model', object: 'model', created: 0, owned_by: 'test' }],
    }),
  );
}

function completionWithToolCall() {
  return {
    id: 'chatcmpl-tool',
    object: 'chat.completion',
    created: 1720000000,
    model: 'test-model',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: toolCall.id,
              type: 'function',
              function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  };
}

for (const id of [ProviderId.OPENAI, ProviderId.GROQ] as const) {
  runProviderContract(
    `${id} OpenAI-compatible adapter`,
    () => new OpenAiCompatibleProvider({ id, baseURL: OPENAI_COMPATIBLE_BASE_URLS[id] }),
    {
      request,
      apiKey: KEY,
      expectedText: 'contract response',
      expectedToolCall: toolCall,
      configure: (scenario) => {
        configure(id, scenario);
      },
    },
  );
}

let lastAuthorization: string | null = null;
describe('OpenAI-compatible provider mapping', () => {
  beforeAll(() => {
    mswServer.listen({ onUnhandledRequest: 'error' });
  });
  afterEach(() => {
    mswServer.resetHandlers();
  });
  afterAll(() => {
    mswServer.close();
  });

  it('sends max_completion_tokens only for OpenAI and maps json response format', async () => {
    const bodies: Record<string, unknown>[] = [];
    const capture = http.post(
      new RegExp(`${OPENAI_COMPATIBLE_BASE_URLS.openai}|${OPENAI_COMPATIBLE_BASE_URLS.groq}`),
      async ({ request: req }) => {
        bodies.push((await req.json()) as Record<string, unknown>);
        lastAuthorization = req.headers.get('authorization');
        return new HttpResponse(JSON.stringify(completionFixture), { headers: { 'content-type': 'application/json' } });
      },
    );
    mswServer.use(capture);
    await new OpenAiCompatibleProvider({ id: ProviderId.OPENAI, baseURL: OPENAI_COMPATIBLE_BASE_URLS.openai }).complete(
      { ...request, responseFormat: 'json' },
      KEY,
      new AbortController().signal,
    );
    await new OpenAiCompatibleProvider({ id: ProviderId.GROQ, baseURL: OPENAI_COMPATIBLE_BASE_URLS.groq }).complete(
      request,
      KEY,
      new AbortController().signal,
    );
    expect(bodies[0]).toMatchObject({ max_completion_tokens: 64, response_format: { type: 'json_object' } });
    expect(bodies[0]).not.toHaveProperty('max_tokens');
    expect(bodies[1]).toHaveProperty('max_tokens', 64);
    expect(bodies[1]).not.toHaveProperty('max_completion_tokens');
  });

  it('accumulates streamed tool-call deltas by index before parsing arguments', async () => {
    const url = `${OPENAI_COMPATIBLE_BASE_URLS.openai}/chat/completions`;
    const chunks = [
      {
        id: 'stream',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'test-model',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: toolCall.id, type: 'function', function: { name: toolCall.name, arguments: '{"que' } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'stream',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'test-model',
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"weather"}' } }] },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'stream',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'test-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      },
      {
        id: 'stream',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'test-model',
        choices: [],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      },
    ];
    const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    mswServer.use(
      http.post(
        url,
        () =>
          new HttpResponse(new TextEncoder().encode(body), {
            headers: { 'content-type': 'text/event-stream' },
          }),
      ),
    );
    const streamedDeltas: string[] = [];
    const result = await new OpenAiCompatibleProvider({
      id: ProviderId.OPENAI,
      baseURL: OPENAI_COMPATIBLE_BASE_URLS.openai,
    }).stream(request, KEY, new AbortController().signal, (delta) => {
      streamedDeltas.push(delta);
    });
    expect(streamedDeltas).toEqual([]);
    expect(result).toMatchObject({
      ok: true,
      value: { finishReason: 'tool_calls', toolCalls: [toolCall], usage: { inputTokens: 2, outputTokens: 1 } },
    });
  });

  it('classifies 429 insufficient_quota as quota exhaustion', async () => {
    configure(ProviderId.OPENAI, 'quota_exhausted');
    const result = await new OpenAiCompatibleProvider({
      id: ProviderId.OPENAI,
      baseURL: OPENAI_COMPATIBLE_BASE_URLS.openai,
    }).complete(request, KEY, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { kind: FailureKind.QUOTA_EXHAUSTED } });
  });

  it('maps malformed tool-call JSON to bad_request', async () => {
    const url = `${OPENAI_COMPATIBLE_BASE_URLS.openai}/chat/completions`;
    const body = completionWithToolCall();
    const firstChoice = body.choices[0];
    const firstToolCall = firstChoice?.message.tool_calls[0];
    if (firstChoice === undefined || firstToolCall === undefined) throw new Error('Tool-call fixture is empty.');
    firstToolCall.function.arguments = '{invalid';
    mswServer.use(jsonFixture(url, body));
    const result = await new OpenAiCompatibleProvider({
      id: ProviderId.OPENAI,
      baseURL: OPENAI_COMPATIBLE_BASE_URLS.openai,
    }).complete(request, KEY, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { kind: FailureKind.BAD_REQUEST } });
  });

  it('maps cached prompt tokens from OpenAI usage details', async () => {
    const url = `${OPENAI_COMPATIBLE_BASE_URLS.openai}/chat/completions`;
    mswServer.use(jsonFixture(url, completionFixture));
    const result = await new OpenAiCompatibleProvider({
      id: ProviderId.OPENAI,
      baseURL: OPENAI_COMPATIBLE_BASE_URLS.openai,
    }).complete(request, KEY, new AbortController().signal);
    expect(result).toMatchObject({
      ok: true,
      value: { usage: { inputTokens: 3, cachedInputTokens: 1, outputTokens: 4 } },
    });
  });

  it('sends the API key only as a bearer credential', async () => {
    const url = `${OPENAI_COMPATIBLE_BASE_URLS.openai}/chat/completions`;
    mswServer.use(
      http.post(url, ({ request: req }) => {
        lastAuthorization = req.headers.get('authorization');
        return new HttpResponse(JSON.stringify(completionFixture), { headers: { 'content-type': 'application/json' } });
      }),
    );
    const result = await new OpenAiCompatibleProvider({
      id: ProviderId.OPENAI,
      baseURL: OPENAI_COMPATIBLE_BASE_URLS.openai,
    }).complete(request, KEY, new AbortController().signal);
    expect(lastAuthorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
});
