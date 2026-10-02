import { ApiError, GoogleGenAI } from '@google/genai';
import { FailureKind, ProviderId } from '@itstudio/schemas';
import type { ProviderFailure } from '../../ports/llm-provider.js';
import type { IEmbeddingProvider } from '../../ports/embedding-provider.js';
import { parseRetryAfter } from '../../domain/failure.js';

const BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_TIMEOUT_MS = 30_000;

export class GoogleEmbeddingProvider implements IEmbeddingProvider {
  readonly id = ProviderId.GOOGLE;
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
    try {
      const response = await new GoogleGenAI({
        apiKey,
        httpOptions: {
          baseUrl: BASE_URL,
          apiVersion: 'v1beta',
          timeout: this.timeoutMs,
          retryOptions: { attempts: 1 },
        },
      }).models.embedContent({
        model: request.modelId,
        contents: [...texts],
        config: { outputDimensionality: request.dimensions, abortSignal: signal },
      });
      const vectors = (response.embeddings ?? []).map((embedding) => embedding.values ?? []);
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
      const inputTokens = texts.reduce((total, text) => total + Math.ceil(text.length / 4), 0);
      return { ok: true, value: { vectors, inputTokens } } as const;
    } catch (error) {
      if (signal.aborted) throw error;
      return { ok: false, error: classifyFailure(error, apiKey) } as const;
    }
  }
}

function classifyFailure(error: unknown, apiKey: string): ProviderFailure {
  const details = getErrorDetails(error);
  const message = details.message.slice(0, 240).replaceAll(apiKey, '[redacted]');
  const dailyQuota = /per day|daily|billing|quota exceeded for quota metric.*per day/i.test(details.message);
  if ((details.status === 429 || details.code === 'RESOURCE_EXHAUSTED') && dailyQuota)
    return {
      kind: FailureKind.QUOTA_EXHAUSTED,
      ...(details.status === undefined ? {} : { httpStatus: details.status }),
      billed: false,
      message,
    };
  if (details.status === 429 || details.code === 'RESOURCE_EXHAUSTED')
    return {
      kind: FailureKind.RATE_LIMITED,
      ...(details.status === undefined ? {} : { httpStatus: details.status }),
      ...(details.retryAfterMs === undefined ? {} : { retryAfterMs: details.retryAfterMs }),
      billed: false,
      message,
    };
  if (
    [401, 403].includes(details.status ?? 0) ||
    ['PERMISSION_DENIED', 'UNAUTHENTICATED', 'API_KEY_INVALID'].includes(details.code)
  )
    return {
      kind: FailureKind.AUTH,
      ...(details.status === undefined ? {} : { httpStatus: details.status }),
      billed: false,
      message,
    };
  if ([400, 404].includes(details.status ?? 0) || details.code === 'INVALID_ARGUMENT')
    return {
      kind: FailureKind.BAD_REQUEST,
      ...(details.status === undefined ? {} : { httpStatus: details.status }),
      billed: false,
      message,
    };
  if ([500, 503].includes(details.status ?? 0) || ['UNAVAILABLE', 'INTERNAL'].includes(details.code))
    return {
      kind: FailureKind.SERVER_ERROR,
      ...(details.status === undefined ? {} : { httpStatus: details.status }),
      billed: false,
      message,
    };
  if (error instanceof Error && (/timeout/i.test(error.name) || error.name === 'AbortError'))
    return { kind: FailureKind.TIMEOUT, billed: false, message: 'The provider request timed out.' };
  return {
    kind: FailureKind.SERVER_ERROR,
    ...(details.status === undefined ? {} : { httpStatus: details.status }),
    billed: false,
    message: message || 'The provider request failed.',
  };
}

function getErrorDetails(error: unknown): {
  readonly status?: number;
  readonly code: string;
  readonly message: string;
  readonly retryAfterMs?: number;
} {
  const rawMessage = error instanceof Error ? error.message : 'The provider request failed.';
  let payload: unknown;
  try {
    payload = JSON.parse(rawMessage) as unknown;
  } catch {
    payload = undefined;
  }
  const root = isRecord(payload) ? payload : {};
  const provider = isRecord(root.error) ? root.error : root;
  const code =
    typeof provider.status === 'string' ? provider.status : typeof provider.code === 'string' ? provider.code : '';
  const message = typeof provider.message === 'string' ? provider.message : rawMessage;
  const providerDetails: readonly unknown[] = Array.isArray(provider.details) ? provider.details : [];
  const retryInfo = providerDetails.find(
    (detail) =>
      isRecord(detail) && (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' || 'retryDelay' in detail),
  );
  const retryAfterMs =
    isRecord(retryInfo) && typeof retryInfo.retryDelay === 'string' ? parseDuration(retryInfo.retryDelay) : undefined;
  const status =
    error instanceof ApiError ? error.status : typeof provider.code === 'number' ? provider.code : undefined;
  const headers = isRecord(error) ? error.headers : undefined;
  const retryHeader = headers instanceof Headers ? parseRetryAfter(headers.get('retry-after'), Date.now()) : undefined;
  const retryDelay = retryAfterMs ?? retryHeader;
  return {
    ...(status === undefined ? {} : { status }),
    code,
    message,
    ...(retryDelay === undefined ? {} : { retryAfterMs: retryDelay }),
  };
}

function parseDuration(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  if (match === null) return undefined;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.round(seconds * 1_000) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
