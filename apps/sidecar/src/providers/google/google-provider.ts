import { ApiError, GoogleGenAI } from '@google/genai';
import { FailureKind, ProviderId } from '@itstudio/schemas';
import type { ILlmProvider, ProviderFailure, ProviderRequest } from '../../ports/llm-provider.js';
import { mapRequest, mapResponse, mapStreamResponse, promptBlockReason } from './mapping.js';

const BASE_URL = 'https://generativelanguage.googleapis.com';

export class GoogleProvider implements ILlmProvider {
  readonly id = ProviderId.GOOGLE;

  async complete(req: ProviderRequest, apiKey: string, signal: AbortSignal) {
    try {
      const mapped = mapRequest(req);
      const response = await this.client(apiKey, req.timeoutMs).models.generateContent({
        model: req.modelId,
        contents: mapped.contents,
        config: {
          ...(mapped.systemInstruction === undefined ? {} : { systemInstruction: mapped.systemInstruction }),
          ...(mapped.tools === undefined ? {} : { tools: [...mapped.tools] }),
          ...(mapped.responseMimeType === undefined ? {} : { responseMimeType: mapped.responseMimeType }),
          ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
          maxOutputTokens: req.maxOutputTokens,
          abortSignal: signal,
        },
      });
      if (promptBlockReason(response) !== undefined)
        return { ok: false, error: contentFiltered('The provider blocked the prompt.') } as const;
      return { ok: true, value: mapResponse(response, req.modelId) } as const;
    } catch (error) {
      if (signal.aborted) throw error;
      return { ok: false, error: classifyFailure(error, apiKey) } as const;
    }
  }

  async stream(req: ProviderRequest, apiKey: string, signal: AbortSignal, onDelta: (text: string) => void) {
    let emitted = false;
    try {
      const mapped = mapRequest(req);
      const stream = await this.client(apiKey, req.timeoutMs).models.generateContentStream({
        model: req.modelId,
        contents: mapped.contents,
        config: {
          ...(mapped.systemInstruction === undefined ? {} : { systemInstruction: mapped.systemInstruction }),
          ...(mapped.tools === undefined ? {} : { tools: [...mapped.tools] }),
          ...(mapped.responseMimeType === undefined ? {} : { responseMimeType: mapped.responseMimeType }),
          ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
          maxOutputTokens: req.maxOutputTokens,
          abortSignal: signal,
        },
      });
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
        if (promptBlockReason(chunk) !== undefined)
          return {
            ok: false,
            error: { ...contentFiltered('The provider blocked the prompt.'), billed: emitted },
          } as const;
        const delta =
          chunk.candidates?.[0]?.content?.parts
            ?.flatMap((part) => (typeof part.text === 'string' ? [part.text] : []))
            .join('') ?? '';
        if (delta.length > 0) {
          emitted = true;
          onDelta(delta);
        }
      }
      return { ok: true, value: mapStreamResponse(chunks, req.modelId) } as const;
    } catch (error) {
      if (signal.aborted) throw error;
      const failure = classifyFailure(error, apiKey);
      return { ok: false, error: { ...failure, billed: emitted } } as const;
    }
  }

  async listModels(apiKey: string, signal: AbortSignal) {
    try {
      const response = await this.client(apiKey).models.list({
        config: { abortSignal: signal, httpOptions: { apiVersion: 'v1beta' } },
      });
      const ids: string[] = [];
      for await (const model of response) {
        if (typeof model.name === 'string') ids.push(model.name.replace(/^models\//, ''));
      }
      return { ok: true, value: ids } as const;
    } catch (error) {
      if (signal.aborted) throw error;
      return { ok: false, error: classifyFailure(error, apiKey) } as const;
    }
  }

  private client(apiKey: string, timeoutMs?: number): GoogleGenAI {
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        baseUrl: BASE_URL,
        apiVersion: 'v1beta',
        ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
        retryOptions: { attempts: 1 },
      },
    });
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
  const details: readonly unknown[] = Array.isArray(provider.details)
    ? provider.details.map((detail: unknown) => detail)
    : [];
  const retryInfo = details.find(
    (detail) =>
      isRecord(detail) && (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' || 'retryDelay' in detail),
  );
  const retryAfterMs =
    isRecord(retryInfo) && typeof retryInfo.retryDelay === 'string' ? parseDuration(retryInfo.retryDelay) : undefined;
  const status =
    error instanceof ApiError ? error.status : typeof provider.code === 'number' ? provider.code : undefined;
  return {
    ...(status === undefined ? {} : { status }),
    code,
    message,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
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

function contentFiltered(message: string): ProviderFailure {
  return { kind: FailureKind.CONTENT_FILTERED, billed: false, message };
}
