import Anthropic, { APIConnectionTimeoutError, APIError } from '@anthropic-ai/sdk';
import { FailureKind, ProviderId } from '@itstudio/schemas';
import type { ILlmProvider, ProviderFailure, ProviderRequest } from '../../ports/llm-provider.js';
import { parseRetryAfter } from '../../domain/failure.js';
import { ImageUnsupportedError, mapRequest, mapResponse } from './mapping.js';

const BASE_URL = 'https://api.anthropic.com';

export class AnthropicProvider implements ILlmProvider {
  readonly id = ProviderId.ANTHROPIC;

  async complete(req: ProviderRequest, apiKey: string, signal: AbortSignal) {
    try {
      const mapped = mapRequest(req);
      const message = await this.client(apiKey, req.timeoutMs).messages.create(
        {
          model: req.modelId,
          max_tokens: req.maxOutputTokens,
          messages: mapped.messages,
          ...(mapped.system === undefined ? {} : { system: mapped.system }),
          ...(mapped.tools === undefined ? {} : { tools: mapped.tools }),
          ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
        },
        { signal },
      );
      return { ok: true, value: mapResponse(message) } as const;
    } catch (error) {
      if (signal.aborted) throw error;
      return { ok: false, error: classifyFailure(error, apiKey) } as const;
    }
  }

  async stream(req: ProviderRequest, apiKey: string, signal: AbortSignal, onDelta: (text: string) => void) {
    let emitted = false;
    try {
      const mapped = mapRequest(req);
      const stream = this.client(apiKey, req.timeoutMs).messages.stream(
        {
          model: req.modelId,
          max_tokens: req.maxOutputTokens,
          messages: mapped.messages,
          ...(mapped.system === undefined ? {} : { system: mapped.system }),
          ...(mapped.tools === undefined ? {} : { tools: mapped.tools }),
          ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
        },
        { signal },
      );
      stream.on('text', (delta) => {
        emitted = true;
        onDelta(delta);
      });
      const message = await stream.finalMessage();
      return { ok: true, value: mapResponse(message) } as const;
    } catch (error) {
      if (signal.aborted) throw error;
      const failure = classifyFailure(error, apiKey);
      return { ok: false, error: { ...failure, billed: emitted } } as const;
    }
  }

  async listModels(apiKey: string, signal: AbortSignal) {
    try {
      const ids: string[] = [];
      for await (const model of this.client(apiKey).models.list({}, { signal })) ids.push(model.id);
      return { ok: true, value: ids } as const;
    } catch (error) {
      if (signal.aborted) throw error;
      return { ok: false, error: classifyFailure(error, apiKey) } as const;
    }
  }

  private client(apiKey: string, timeout?: number): Anthropic {
    return new Anthropic({ apiKey, baseURL: BASE_URL, maxRetries: 0, ...(timeout === undefined ? {} : { timeout }) });
  }
}

function classifyFailure(error: unknown, apiKey: string): ProviderFailure {
  if (error instanceof ImageUnsupportedError) {
    return { kind: FailureKind.BAD_REQUEST, billed: false, message: error.message };
  }
  if (error instanceof APIConnectionTimeoutError) {
    return { kind: FailureKind.TIMEOUT, billed: false, message: 'The provider request timed out.' };
  }
  if (isAnthropicApiError(error)) {
    const status = error.status;
    const providerType = error.type ?? '';
    const providerMessage = safeProviderMessage(error.error);
    const message = `${providerType}${providerMessage ? `: ${providerMessage}` : ''}`
      .slice(0, 240)
      .replaceAll(apiKey, '[redacted]');
    if (status === 429 && providerType === 'rate_limit_error') {
      const retryAfterMs = parseRetryAfter(error.headers?.get('retry-after'), Date.now());
      return {
        kind: FailureKind.RATE_LIMITED,
        httpStatus: status,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        billed: false,
        message: message || 'The provider rate limit was reached.',
      };
    }
    if ((status === 400 || status === 402) && /credit balance|billing|quota/i.test(providerMessage)) {
      return { kind: FailureKind.QUOTA_EXHAUSTED, httpStatus: status, billed: false, message };
    }
    if (status === 401 || status === 403) return { kind: FailureKind.AUTH, httpStatus: status, billed: false, message };
    if ([400, 404, 413, 422].includes(status ?? 0)) {
      return {
        kind: FailureKind.BAD_REQUEST,
        ...(status === undefined ? {} : { httpStatus: status }),
        billed: false,
        message,
      };
    }
    if ([500, 502, 503, 504, 529].includes(status ?? 0) || providerType === 'overloaded_error') {
      return {
        kind: FailureKind.SERVER_ERROR,
        ...(status === undefined ? {} : { httpStatus: status }),
        billed: false,
        message,
      };
    }
    return {
      kind: FailureKind.SERVER_ERROR,
      ...(status === undefined ? {} : { httpStatus: status }),
      billed: false,
      message,
    };
  }
  const raw = error instanceof Error ? error.message : 'Network request failed.';
  return {
    kind: FailureKind.SERVER_ERROR,
    billed: false,
    message: raw.slice(0, 200).replaceAll(apiKey, '[redacted]'),
  };
}

function isAnthropicApiError(
  error: unknown,
): error is APIError<number | undefined, Headers | undefined, object | undefined> {
  return error instanceof APIError;
}

function safeProviderMessage(value: object | undefined): string {
  if (value === undefined || !('error' in value)) return '';
  const detail = value.error;
  if (typeof detail !== 'object' || detail === null || !('message' in detail)) return '';
  const message = detail.message;
  return typeof message === 'string' ? message.slice(0, 200) : '';
}
