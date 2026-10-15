import { ErrorCode, type AppSettings, type AppError, type ProviderId, type Result } from '@itstudio/schemas';
import { compatibleBaseUrl, compatibleHeaders } from '../../domain/provider-endpoints.js';
import type { IHttpClient } from '../../ports/http-client.js';

export interface IProviderKeyVerifier {
  verify(provider: ProviderId, key: string, signal?: AbortSignal): Promise<Result<void>>;
}

const TIMEOUT_MS = 25_000;

function providerRequest(
  provider: ProviderId,
  key: string,
  settings?: AppSettings,
  qwenModelId?: string,
): { readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly body?: string } {
  const base = compatibleBaseUrl(provider, settings);
  if (provider === 'qwen') {
    if (qwenModelId === undefined || base === undefined) throw new Error('Qwen verification model is unavailable.');
    return {
      url: base.replace(/\/$/, '') + '/chat/completions',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model: qwenModelId, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 }),
    };
  }
  if (base !== undefined)
    return {
      url: `${base.replace(/\/$/, '')}/${provider === 'openrouter' ? 'key' : 'models'}`,
      headers: { ...compatibleHeaders(provider), authorization: `Bearer ${key}` },
    };
  switch (provider) {
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      };
    case 'google':
      return {
        url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
        headers: { 'x-goog-api-key': key },
      };
    case 'replicate':
      return { url: 'https://api.replicate.com/v1/account', headers: { authorization: `Bearer ${key}` } };
    case 'openai':
    case 'xai':
    case 'groq':
    case 'together':
    case 'deepseek':
    case 'openrouter':
    case 'mistral':
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

  private readonly settings: (() => Promise<Result<AppSettings>>) | undefined;

  private readonly qwenModelId: string | undefined;

  constructor(http: IHttpClient, settings?: () => Promise<Result<AppSettings>>, qwenModelId?: string) {
    this.qwenModelId = qwenModelId;
    this.settings = settings;
    this.http = http;
  }

  async verify(provider: ProviderId, key: string, signal?: AbortSignal): Promise<Result<void>> {
    try {
      const settings = await this.settings?.();
      if (settings !== undefined && !settings.ok) return settings;
      const request = providerRequest(provider, key, settings?.value, this.qwenModelId);
      const response = await this.http.request(request.url, {
        method: request.body === undefined ? 'GET' : 'POST',
        ...(request.body === undefined ? {} : { body: request.body }),
        headers: request.headers,
        signal:
          signal === undefined
            ? AbortSignal.timeout(TIMEOUT_MS)
            : AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
      });
      if (response.status === 200) return { ok: true, value: undefined };
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          error: failure(ErrorCode.PROVIDER_AUTH, `The API key for ${provider} was rejected.`, false, [
            'The provider rejected this key.',
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
      if (signal?.aborted === true)
        return {
          ok: false,
          error: failure(ErrorCode.CANCELLED, 'Key verification was cancelled.', true, [
            'Retry verification when ready.',
          ]),
        };
      if (isTimeout(error)) {
        return {
          ok: false,
          error: failure(ErrorCode.PROVIDER_TIMEOUT, `The ${provider} verification request timed out.`, true, [
            'The provider did not answer in time — check your network and try again; the key was not saved.',
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
