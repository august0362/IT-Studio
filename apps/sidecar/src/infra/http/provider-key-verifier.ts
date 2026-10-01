import { ErrorCode, type AppError, type ProviderId, type Result } from '@itstudio/schemas';
import type { IHttpClient } from '../../ports/http-client.js';

export interface IProviderKeyVerifier {
  verify(provider: ProviderId, key: string): Promise<Result<void>>;
}

const TIMEOUT_MS = 10_000;
const OPENAI_COMPATIBLE_BASES: Partial<Record<ProviderId, string>> = {
  openai: 'https://api.openai.com/v1',
  xai: 'https://api.x.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  together: 'https://api.together.xyz/v1',
};

function providerRequest(
  provider: ProviderId,
  key: string,
): { readonly url: string; readonly headers: Readonly<Record<string, string>> } {
  const base = OPENAI_COMPATIBLE_BASES[provider];
  if (base !== undefined) return { url: `${base}/models`, headers: { authorization: `Bearer ${key}` } };
  switch (provider) {
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      };
    case 'google':
      return { url: 'https://generativelanguage.googleapis.com/v1beta/models', headers: { 'x-goog-api-key': key } };
    case 'replicate':
      return { url: 'https://api.replicate.com/v1/account', headers: { authorization: `Bearer ${key}` } };
    case 'openai':
    case 'xai':
    case 'groq':
    case 'together':
      return { url: '', headers: {} };
  }
}

function failure(
  code: AppError['code'],
  message: string,
  retryable: boolean,
  remediation: readonly string[],
): AppError {
  return { code, message, retryable, remediation };
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

export class FetchHttpClient implements IHttpClient {
  request(input: string | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
  }
}

export class ProviderKeyVerifier implements IProviderKeyVerifier {
  private readonly http: IHttpClient;

  constructor(http: IHttpClient) {
    this.http = http;
  }

  async verify(provider: ProviderId, key: string): Promise<Result<void>> {
    const request = providerRequest(provider, key);
    try {
      const response = await this.http.request(request.url, {
        method: 'GET',
        headers: request.headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 200) return { ok: true, value: undefined };
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          error: failure(ErrorCode.PROVIDER_AUTH, `The API key for ${provider} was rejected.`, false, [
            `Re-enter the API key for ${provider}.`,
          ]),
        };
      }
      if (response.status >= 500) {
        return {
          ok: false,
          error: failure(ErrorCode.PROVIDER_SERVER, `The ${provider} service is unavailable.`, true, [
            'Try verifying the API key again shortly.',
          ]),
        };
      }
      return {
        ok: false,
        error: failure(ErrorCode.PROVIDER_SERVER, `The ${provider} service returned an unexpected response.`, false, [
          'Check the provider service and try again.',
        ]),
      };
    } catch (error) {
      if (isTimeout(error)) {
        return {
          ok: false,
          error: failure(ErrorCode.PROVIDER_TIMEOUT, `The ${provider} verification request timed out.`, true, [
            'Try verifying the API key again.',
          ]),
        };
      }
      return {
        ok: false,
        error: failure(ErrorCode.PROVIDER_SERVER, `Could not reach the ${provider} service.`, true, [
          'Check your internet connection and try again.',
        ]),
      };
    }
  }
}
