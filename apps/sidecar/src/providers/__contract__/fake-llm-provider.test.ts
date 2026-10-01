import { describe, expect, it } from 'vitest';
import { FailureKind, ProviderId, type ToolCall } from '@itstudio/schemas';
import { toolCallIdSchema } from '../../validation/brand.js';
import type { ProviderRequest, ProviderResponse } from '../../ports/llm-provider.js';
import { runProviderContract, type ProviderContractScenario } from './provider-contract.js';
import { FakeLlmProvider, providerFailure, responseFor } from './fake-llm-provider.js';
import { mswServer } from '../testing/msw-harness.js';

const request: ProviderRequest = {
  modelId: 'fake-model',
  messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
  maxOutputTokens: 32,
  responseFormat: 'text',
  timeoutMs: 1_000,
};

const toolCall: ToolCall = {
  id: toolCallIdSchema.parse('00000000-0000-4000-8000-000000000001'),
  name: 'search_knowledge',
  arguments: { query: 'contract query' },
};

const scenarios: Readonly<Record<ProviderContractScenario, () => FakeLlmProvider>> = {
  complete: () => new FakeLlmProvider(),
  stream: () => new FakeLlmProvider({ deltas: ['contract ', 'response'] }),
  tool_call: () => new FakeLlmProvider({ complete: { ok: true, value: toolResponse() } }),
  rate_limited: () =>
    new FakeLlmProvider({
      complete: providerFailure(FailureKind.RATE_LIMITED, { httpStatus: 429, retryAfterMs: 2_000 }),
    }),
  quota_exhausted: () =>
    new FakeLlmProvider({ complete: providerFailure(FailureKind.QUOTA_EXHAUSTED, { httpStatus: 429 }) }),
  auth: () => new FakeLlmProvider({ complete: providerFailure(FailureKind.AUTH, { httpStatus: 401 }) }),
  bad_request: () => new FakeLlmProvider({ complete: providerFailure(FailureKind.BAD_REQUEST, { httpStatus: 400 }) }),
  server_error_500: () =>
    new FakeLlmProvider({ complete: providerFailure(FailureKind.SERVER_ERROR, { httpStatus: 500 }) }),
  server_error_503: () =>
    new FakeLlmProvider({ complete: providerFailure(FailureKind.SERVER_ERROR, { httpStatus: 503 }) }),
  server_error_529: () =>
    new FakeLlmProvider({ complete: providerFailure(FailureKind.SERVER_ERROR, { httpStatus: 529 }) }),
  timeout: () => new FakeLlmProvider({ stream: providerFailure(FailureKind.TIMEOUT) }),
  abort: () => new FakeLlmProvider(),
};

function toolResponse(): ProviderResponse {
  return {
    ...responseFor(request, ''),
    toolCalls: [toolCall],
    finishReason: 'tool_calls',
  };
}

runProviderContract('FakeLlmProvider', (scenario) => scenarios[scenario](), {
  request,
  apiKey: 'contract-test-key',
  expectedText: 'contract response',
  expectedToolCall: toolCall,
  configure: () => {
    mswServer.resetHandlers();
  },
});

describe('FakeLlmProvider scripts', () => {
  it('returns a caller-scripted result', async () => {
    const provider = new FakeLlmProvider({
      complete: { ok: true, value: { ...responseFor(request, 'scripted'), finishReason: 'length' } },
    });
    const result = await provider.complete(request, 'unused', new AbortController().signal);
    expect(result).toMatchObject({ ok: true, value: { text: 'scripted', finishReason: 'length' } });
    expect(provider.id).toBe(ProviderId.OPENAI);
  });
});
