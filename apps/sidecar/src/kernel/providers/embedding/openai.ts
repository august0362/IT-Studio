import { FailureKind, ProviderId } from '@itstudio/schemas';
import type { ProviderFailure } from '../../ports/llm-provider.js';
import type { IEmbeddingProvider } from '../../ports/embedding-provider.js';
import { parseRetryAfter } from '../../domain/failure.js';

const BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 30_000;

export class OpenAiEmbeddingProvider implements IEmbeddingProvider {
  readonly id = ProviderId.OPENAI;
  private readonly timeoutMs: number;

  constructor(timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  async embed(
    texts: readonly string[],
    request: { readonly modelId: string; readonly dimensions: number },
    apiKey: string,
    signal: AbortSignal,
  ) {
    let isTimeoutError: ((error: unknown) => boolean) | undefined;
    let isApiError: ((error: unknown) => boolean) | undefined;
    try {
      const { default: OpenAI, APIConnectionTimeoutError, APIError } = await import('openai');
      isTimeoutError = (error) => error instanceof APIConnectionTimeoutError;
      isApiError = (error) => error instanceof APIError;
      const response = await new OpenAI({
        apiKey,
        baseURL: BASE_URL,
        maxRetries: 0,
        timeout: this.timeoutMs,
      }).embeddings.create({ model: request.modelId, input: [...texts], dimensions: request.dimensions }, { signal });
      const vectors = response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
      const invalid = vectors.findIndex((vector) => vector.length !== request.dimensions);
      if (invalid >= 0 || vectors.length !== texts.length)
        return {
          ok: false,
          error: {
            kind: FailureKind.BAD_REQUEST,
            billed: false,
            message: `Embedding provider returned ${String(vectors[invalid]?.length ?? vectors.length)} vectors or dimensions that did not match the requested ${String(request.dimensions)}.`,
          },
        } as const;
      return { ok: true, value: { vectors, inputTokens: response.usage.prompt_tokens } } as const;
    } catch (error) {
      if (signal.aborted) throw error;
      return {
        ok: false,
        error: classifyFailure(error, apiKey, isTimeoutError?.(error) ?? false, isApiError?.(error) ?? false),
      } as const;
    }
  }
}

function classifyFailure(
  error: unknown,
  apiKey: string,
  isTimeoutError: boolean,
  isApiError: boolean,
): ProviderFailure {
  if (isTimeoutError) return { kind: FailureKind.TIMEOUT, billed: false, message: 'The provider request timed out.' };
  if (isApiError && error instanceof Error) {
    const serialized: unknown = JSON.parse(JSON.stringify(error)) as unknown;
    const record = isRecord(serialized) ? serialized : {};
    const status = typeof record.status === 'number' ? record.status : undefined;
    const code = typeof record.code === 'string' ? record.code : '';
    const type = typeof record.type === 'string' ? record.type : '';
    const headers: unknown = Object.getOwnPropertyDescriptor(error, 'headers')?.value;
    const retryAfterMs = headers instanceof Headers ? retryAfter(headers) : undefined;
    const message = error.message.slice(0, 200).replaceAll(apiKey, '[redacted]');
    if (
      status === 429 &&
      (code === 'insufficient_quota' || type === 'insufficient_quota' || /quota|billing/i.test(message))
    )
      return { kind: FailureKind.QUOTA_EXHAUSTED, httpStatus: status, billed: false, message };
    if (status === 429) {
      return {
        kind: FailureKind.RATE_LIMITED,
        httpStatus: status,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        billed: false,
        message,
      };
    }
    if (status === 401 || status === 403) return { kind: FailureKind.AUTH, httpStatus: status, billed: false, message };
    if (status === 400 || status === 404 || status === 422)
      return { kind: FailureKind.BAD_REQUEST, httpStatus: status, billed: false, message };
    return {
      kind: FailureKind.SERVER_ERROR,
      ...(status === undefined ? {} : { httpStatus: status }),
      billed: false,
      message,
    };
  }
  const message = error instanceof Error ? error.message : 'Network request failed.';
  return {
    kind: FailureKind.SERVER_ERROR,
    billed: false,
    message: message.slice(0, 200).replaceAll(apiKey, '[redacted]'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function retryAfter(headers: Headers): number | undefined {
  const milliseconds = headers.get('retry-after-ms');
  if (milliseconds !== null && /^\d+(?:\.\d+)?$/.test(milliseconds.trim()))
    return Math.max(0, Math.round(Number(milliseconds)));
  return parseRetryAfter(headers.get('retry-after'), Date.now());
}
