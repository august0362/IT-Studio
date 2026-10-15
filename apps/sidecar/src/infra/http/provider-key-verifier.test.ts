import { ErrorCode, ProviderId, type ProviderId as ProviderIdType } from '@itstudio/schemas';
import { HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadSeeds } from '../../config/load-seeds.js';
import { buildDefaultSettings } from '../../domain/default-settings.js';
import type { IHttpClient } from '../../ports/http-client.js';
import { captureRequest, mswServer } from '../../providers/testing/msw-harness.js';
import { FetchHttpClient, ProviderKeyVerifier } from './provider-key-verifier.js';

beforeAll(() => {
  mswServer.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  mswServer.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => {
  mswServer.close();
});

const cases: readonly {
  readonly provider: ProviderIdType;
  readonly url: string;
  readonly header: string;
  readonly value: string;
}[] = [
  {
    provider: ProviderId.ANTHROPIC,
    url: 'https://api.anthropic.com/v1/models',
    header: 'x-api-key',
    value: 'sentinel-secret',
  },
  {
    provider: ProviderId.OPENAI,
    url: 'https://api.openai.com/v1/models',
    header: 'authorization',
    value: 'Bearer sentinel-secret',
  },
  {
    provider: ProviderId.GOOGLE,
    url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
    header: 'x-goog-api-key',
    value: 'sentinel-secret',
  },
  {
    provider: ProviderId.XAI,
    url: 'https://api.x.ai/v1/models',
    header: 'authorization',
    value: 'Bearer sentinel-secret',
  },
  {
    provider: ProviderId.GROQ,
    url: 'https://api.groq.com/openai/v1/models',
    header: 'authorization',
    value: 'Bearer sentinel-secret',
  },
  {
    provider: ProviderId.TOGETHER,
    url: 'https://api.together.xyz/v1/models',
    header: 'authorization',
    value: 'Bearer sentinel-secret',
  },
  ...[
    { provider: ProviderId.DEEPSEEK, url: 'https://api.deepseek.com/models' },
    { provider: ProviderId.OPENROUTER, url: 'https://openrouter.ai/api/v1/key' },
    { provider: ProviderId.QWEN, url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions' },
    { provider: ProviderId.MISTRAL, url: 'https://api.mistral.ai/v1/models' },
  ].map((item) => ({ ...item, header: 'authorization', value: 'Bearer sentinel-secret' })),
  {
    provider: ProviderId.REPLICATE,
    url: 'https://api.replicate.com/v1/account',
    header: 'authorization',
    value: 'Bearer sentinel-secret',
  },
];

class FakeHttpClient implements IHttpClient {
  input = '';
  init: RequestInit | undefined;
  calls = 0;
  handler: () => Promise<Response> = () => Promise.resolve(new Response(null, { status: 200 }));

  request(input: string | URL, init?: RequestInit): Promise<Response> {
    this.calls += 1;
    this.input = input.toString();
    this.init = init;
    return this.handler();
  }
}

describe('ProviderKeyVerifier', () => {
  it.each(cases)('PROV-01 maps network errors without exposing keys for $provider', async ({ provider }) => {
    const http = new FakeHttpClient();
    http.handler = () => Promise.reject(new Error('sentinel-secret'));
    const result = await new ProviderKeyVerifier(http, undefined, 'qwen-flash').verify(provider, 'sentinel-secret');
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.PROVIDER_SERVER } });
    expect(JSON.stringify(result)).not.toContain('sentinel-secret');
  });

  it('PROV-01 reads the saved Qwen endpoint for each verification and attaches OpenRouter attribution', async () => {
    const loaded = loadSeeds('config');
    if (!loaded.ok) throw new Error(loaded.error.message);
    let endpoint = 'https://dashscope-us.aliyuncs.com/compatible-mode/v1/';
    const http = new FakeHttpClient();
    const verifier = new ProviderKeyVerifier(
      http,
      () =>
        Promise.resolve({
          ok: true,
          value: {
            ...buildDefaultSettings(loaded.value),
            providers: { qwen: { baseUrl: endpoint } },
          },
        }),
      'qwen-flash',
    );
    await verifier.verify(ProviderId.QWEN, 'sentinel-secret');
    expect(http.input).toBe('https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions');
    endpoint = 'https://workspace.example/compatible/v1';
    await verifier.verify(ProviderId.QWEN, 'sentinel-secret');
    expect(http.input).toBe(endpoint + '/chat/completions');
    await verifier.verify(ProviderId.OPENROUTER, 'sentinel-secret');
    expect(http.input).toBe('https://openrouter.ai/api/v1/key');
    const headers = new Headers(http.init?.headers);
    expect(headers.get('HTTP-Referer')).toBe('https://itstudio.local');
    expect(headers.get('X-OpenRouter-Title')).toBe('IT Studio');
    expect(headers.get('X-Title')).toBe('IT Studio');
  });
  it.each(cases)('uses the correct URL and auth header for $provider', async ({ provider, url, header, value }) => {
    const http = new FakeHttpClient();
    expect(await new ProviderKeyVerifier(http, undefined, 'qwen-flash').verify(provider, 'sentinel-secret')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(http.input).toBe(url);
    expect(http.calls).toBe(1);
    expect(new Headers(http.init?.headers).get(header)).toBe(value);
    if (provider === ProviderId.ANTHROPIC)
      expect(new Headers(http.init?.headers).get('anthropic-version')).toBe('2023-06-01');
    expect(http.init?.method).toBe(provider === ProviderId.QWEN ? 'POST' : 'GET');
    if (provider === ProviderId.QWEN) {
      const body = http.init?.body;
      if (typeof body !== 'string') throw new Error('Expected a JSON verification request body');
      expect(JSON.parse(body)).toEqual({
        model: 'qwen-flash',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
      });
    }
  });

  it.each(cases)('maps 401 and 403 to PROVIDER_AUTH for $provider', async ({ provider }) => {
    for (const status of [401, 403]) {
      const http = new FakeHttpClient();
      http.handler = () => Promise.resolve(new Response(null, { status }));
      const result = await new ProviderKeyVerifier(http, undefined, 'qwen-flash').verify(provider, 'sentinel-secret');
      expect(result).toMatchObject({
        ok: false,
        error: { code: ErrorCode.PROVIDER_AUTH, remediation: ['The provider rejected this key.'] },
      });
      expect(JSON.stringify(result)).not.toContain('sentinel-secret');
    }
  });

  it.each(cases)('maps server errors to retryable PROVIDER_SERVER for $provider', async ({ provider }) => {
    const http = new FakeHttpClient();
    http.handler = () => Promise.resolve(new Response(null, { status: 500 }));
    expect(await new ProviderKeyVerifier(http, undefined, 'qwen-flash').verify(provider, 'secret')).toMatchObject({
      ok: false,
      error: { code: ErrorCode.PROVIDER_SERVER, retryable: true },
    });
  });

  it.each(cases)('maps timeouts to PROVIDER_TIMEOUT for $provider', async ({ provider }) => {
    const http = new FakeHttpClient();
    http.handler = () => Promise.reject(new DOMException('timeout', 'TimeoutError'));
    expect(await new ProviderKeyVerifier(http, undefined, 'qwen-flash').verify(provider, 'secret')).toMatchObject({
      ok: false,
      error: {
        code: ErrorCode.PROVIDER_TIMEOUT,
        retryable: true,
        remediation: ['The provider did not answer in time — check your network and try again; the key was not saved.'],
      },
    });
    expect(http.init?.signal).toBeInstanceOf(AbortSignal);
    expect(http.calls).toBe(1);
  });

  it.each(cases)('sends only one intercepted HTTP request for $provider', async ({ provider, url, header, value }) => {
    let calls = 0;
    let requestUrl: URL | undefined;
    mswServer.use(
      captureRequest(
        new URL(url).origin + new URL(url).pathname,
        ({ request, url: capturedUrl }) => {
          calls += 1;
          requestUrl = capturedUrl;
          expect(new Headers(request.headers).get(header)).toBe(value);
        },
        () => HttpResponse.json({ data: [] }),
      ),
    );

    const result = await new ProviderKeyVerifier(new FetchHttpClient(), undefined, 'qwen-flash').verify(
      provider,
      'sentinel-secret',
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(calls).toBe(1);
    expect(requestUrl?.toString()).toBe(url);
  });

  it('uses a 25 second abort timeout', async () => {
    const http = new FakeHttpClient();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    await new ProviderKeyVerifier(http, undefined, 'qwen-flash').verify(ProviderId.OPENAI, 'secret');
    expect(timeout).toHaveBeenCalledWith(25_000);
  });
});
