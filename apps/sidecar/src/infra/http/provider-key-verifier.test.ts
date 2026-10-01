import { ErrorCode, ProviderId, type ProviderId as ProviderIdType } from '@itstudio/schemas';
import { describe, expect, it } from 'vitest';
import type { IHttpClient } from '../../ports/http-client.js';
import { ProviderKeyVerifier } from './provider-key-verifier.js';

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
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
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
  handler: () => Promise<Response> = () => Promise.resolve(new Response(null, { status: 200 }));

  request(input: string | URL, init?: RequestInit): Promise<Response> {
    this.input = input.toString();
    this.init = init;
    return this.handler();
  }
}

describe('ProviderKeyVerifier', () => {
  it.each(cases)('uses the correct URL and auth header for $provider', async ({ provider, url, header, value }) => {
    const http = new FakeHttpClient();
    expect(await new ProviderKeyVerifier(http).verify(provider, 'sentinel-secret')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(http.input).toBe(url);
    expect(new Headers(http.init?.headers).get(header)).toBe(value);
    if (provider === ProviderId.ANTHROPIC)
      expect(new Headers(http.init?.headers).get('anthropic-version')).toBe('2023-06-01');
    expect(http.init?.method).toBe('GET');
  });

  it.each(cases)('maps 401 and 403 to PROVIDER_AUTH for $provider', async ({ provider }) => {
    for (const status of [401, 403]) {
      const http = new FakeHttpClient();
      http.handler = () => Promise.resolve(new Response(null, { status }));
      const result = await new ProviderKeyVerifier(http).verify(provider, 'sentinel-secret');
      expect(result).toMatchObject({
        ok: false,
        error: { code: ErrorCode.PROVIDER_AUTH, remediation: [`Re-enter the API key for ${provider}.`] },
      });
      expect(JSON.stringify(result)).not.toContain('sentinel-secret');
    }
  });

  it.each(cases)('maps server errors to retryable PROVIDER_SERVER for $provider', async ({ provider }) => {
    const http = new FakeHttpClient();
    http.handler = () => Promise.resolve(new Response(null, { status: 500 }));
    expect(await new ProviderKeyVerifier(http).verify(provider, 'secret')).toMatchObject({
      ok: false,
      error: { code: ErrorCode.PROVIDER_SERVER, retryable: true },
    });
  });

  it.each(cases)('maps timeouts to PROVIDER_TIMEOUT for $provider', async ({ provider }) => {
    const http = new FakeHttpClient();
    http.handler = () => Promise.reject(new DOMException('timeout', 'TimeoutError'));
    expect(await new ProviderKeyVerifier(http).verify(provider, 'secret')).toMatchObject({
      ok: false,
      error: { code: ErrorCode.PROVIDER_TIMEOUT, retryable: true },
    });
    expect(http.init?.signal).toBeInstanceOf(AbortSignal);
  });
});
