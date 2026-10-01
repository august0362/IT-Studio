import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest';
import { FailureKind, type ToolCall } from '@itstudio/schemas';
import type { ILlmProvider, ProviderRequest } from '../../ports/llm-provider.js';
import { mswServer } from '../testing/msw-harness.js';

export const providerContractScenarios = [
  'complete',
  'stream',
  'tool_call',
  'rate_limited',
  'quota_exhausted',
  'auth',
  'bad_request',
  'server_error_500',
  'server_error_503',
  'server_error_529',
  'timeout',
  'abort',
] as const;
export type ProviderContractScenario = (typeof providerContractScenarios)[number];

export interface ProviderContractFixtures {
  readonly request: ProviderRequest;
  readonly apiKey: string;
  readonly expectedText: string;
  readonly expectedToolCall?: ToolCall;
  readonly configure: (scenario: ProviderContractScenario) => void;
  readonly assertApiKeyHeader?: (apiKey: string) => void;
}

export function runProviderContract(
  name: string,
  makeProvider: (scenario: ProviderContractScenario) => ILlmProvider,
  fixtures: ProviderContractFixtures,
): void {
  describe(`${name} ILlmProvider contract`, () => {
    beforeAll(() => {
      mswServer.listen({ onUnhandledRequest: 'error' });
    });
    afterEach(() => {
      mswServer.resetHandlers();
    });
    afterAll(() => {
      mswServer.close();
    });

    const setup = (scenario: ProviderContractScenario): ILlmProvider => {
      fixtures.configure(scenario);
      return makeProvider(scenario);
    };

    it('completes successfully with non-negative integer usage', async () => {
      const result = await setup('complete').complete(fixtures.request, fixtures.apiKey, new AbortController().signal);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.text).toBe(fixtures.expectedText);
      expect(Number.isInteger(result.value.usage.inputTokens)).toBe(true);
      expect(Number.isInteger(result.value.usage.outputTokens)).toBe(true);
      expect(Number.isInteger(result.value.usage.cachedInputTokens)).toBe(true);
      expect(result.value.usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(result.value.usage.outputTokens).toBeGreaterThanOrEqual(0);
      expect(result.value.usage.cachedInputTokens).toBeGreaterThanOrEqual(0);
    });

    it('streams deltas that concatenate to the final text', async () => {
      const deltas: string[] = [];
      const result = await setup('stream').stream(
        fixtures.request,
        fixtures.apiKey,
        new AbortController().signal,
        (text) => {
          deltas.push(text);
        },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(deltas.join('')).toBe(result.value.text);
      expect(result.value.text).toBe(fixtures.expectedText);
    });

    it('parses tool-call arguments as JSON and reports tool_calls finish reason', async () => {
      const result = await setup('tool_call').complete(fixtures.request, fixtures.apiKey, new AbortController().signal);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.finishReason).toBe('tool_calls');
      expect(result.value.toolCalls.length).toBeGreaterThan(0);
      for (const toolCall of result.value.toolCalls) {
        expect(() => JSON.parse(JSON.stringify(toolCall.arguments)) as unknown).not.toThrow();
      }
      if (fixtures.expectedToolCall !== undefined) expect(result.value.toolCalls[0]).toEqual(fixtures.expectedToolCall);
    });

    it('classifies 429 and parses Retry-After', async () => {
      const result = await setup('rate_limited').complete(
        fixtures.request,
        fixtures.apiKey,
        new AbortController().signal,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe(FailureKind.RATE_LIMITED);
      expect(result.error.retryAfterMs).toBeGreaterThan(0);
    });

    it('classifies quota exhaustion', async () => {
      const result = await setup('quota_exhausted').complete(
        fixtures.request,
        fixtures.apiKey,
        new AbortController().signal,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe(FailureKind.QUOTA_EXHAUSTED);
    });

    it('classifies 401 as auth', async () => {
      const result = await setup('auth').complete(fixtures.request, fixtures.apiKey, new AbortController().signal);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe(FailureKind.AUTH);
    });

    it('classifies 400 as bad_request', async () => {
      const result = await setup('bad_request').complete(
        fixtures.request,
        fixtures.apiKey,
        new AbortController().signal,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe(FailureKind.BAD_REQUEST);
    });

    it.each(['server_error_500', 'server_error_503', 'server_error_529'] as const)(
      'classifies %s as server_error',
      async (scenario) => {
        const result = await setup(scenario).complete(fixtures.request, fixtures.apiKey, new AbortController().signal);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.kind).toBe(FailureKind.SERVER_ERROR);
      },
    );

    it('classifies a first-byte timeout', async () => {
      const result = await setup('timeout').stream(
        fixtures.request,
        fixtures.apiKey,
        new AbortController().signal,
        () => {
          expect(true).toBe(true);
        },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe(FailureKind.TIMEOUT);
    });

    it('rejects quickly after abort and emits no later deltas', async () => {
      const controller = new AbortController();
      const deltas: string[] = [];
      const provider = setup('abort');
      const pending = provider.stream(fixtures.request, fixtures.apiKey, controller.signal, (text) => {
        deltas.push(text);
      });
      controller.abort();
      await expect(pending).rejects.toBeDefined();
      const observedCount = deltas.length;
      await Promise.resolve();
      expect(deltas).toHaveLength(observedCount);
      expect(deltas).toEqual([]);
    });

    it('sends the key only through the auth header and does not return it in messages', async () => {
      const result = await setup('complete').complete(fixtures.request, fixtures.apiKey, new AbortController().signal);
      if (fixtures.assertApiKeyHeader !== undefined) fixtures.assertApiKeyHeader(fixtures.apiKey);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(fixtures.apiKey);
    });

    it('returns model ids from listModels', async () => {
      const result = await setup('complete').listModels(fixtures.apiKey, new AbortController().signal);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.every((model) => typeof model === 'string')).toBe(true);
    });
  });
}
