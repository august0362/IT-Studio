import OpenAI, { APIConnectionTimeoutError, APIError } from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import { FailureKind, ProviderId } from '@itstudio/schemas';
import type { ILlmProvider, ProviderFailure, ProviderRequest, ProviderResponse } from '../../ports/llm-provider.js';
import { parseRetryAfter } from '../../domain/failure.js';
import { finishReason, mapMessages, mapResponse, mapTools, parseToolCalls, UnsupportedImageError } from './mapping.js';

export const OPENAI_COMPATIBLE_BASE_URLS = {
  [ProviderId.OPENAI]: 'https://api.openai.com/v1',
  [ProviderId.XAI]: 'https://api.x.ai/v1',
  [ProviderId.GROQ]: 'https://api.groq.com/openai/v1',
  [ProviderId.TOGETHER]: 'https://api.together.xyz/v1',
} as const;

export interface OpenAiCompatibleProviderOptions {
  readonly id: ProviderId;
  readonly baseURL: string;
}

export class OpenAiCompatibleProvider implements ILlmProvider {
  readonly id: ProviderId;
  private readonly baseURL: string;

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.id = options.id;
    this.baseURL = options.baseURL;
  }

  async complete(req: ProviderRequest, apiKey: string, signal: AbortSignal) {
    try {
      const client = this.client(apiKey, req.timeoutMs);
      const tools = req.tools === undefined ? undefined : (mapTools(req) ?? []);
      const params: ChatCompletionCreateParamsNonStreaming = {
        model: req.modelId,
        messages: mapMessages(req),
        ...(this.id === ProviderId.OPENAI
          ? { max_completion_tokens: req.maxOutputTokens }
          : { max_tokens: req.maxOutputTokens }),
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
        ...(tools === undefined ? {} : { tools, tool_choice: 'auto' }),
        ...(req.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
      };
      const completion = await client.chat.completions.create(params, { signal });
      const mapped = mapResponse(completion);
      if ('failure' in mapped) return { ok: false, error: badRequest(mapped.message) } as const;
      return { ok: true, value: mapped } as const;
    } catch (error) {
      if (signal.aborted) throw error;
      return { ok: false, error: classifyFailure(error, apiKey) } as const;
    }
  }

  async stream(req: ProviderRequest, apiKey: string, signal: AbortSignal, onDelta: (text: string) => void) {
    let emitted = false;
    try {
      const client = this.client(apiKey, req.timeoutMs);
      const tools = req.tools === undefined ? undefined : (mapTools(req) ?? []);
      const params: ChatCompletionCreateParamsStreaming = {
        model: req.modelId,
        messages: mapMessages(req),
        stream: true,
        stream_options: { include_usage: true },
        ...(this.id === ProviderId.OPENAI
          ? { max_completion_tokens: req.maxOutputTokens }
          : { max_tokens: req.maxOutputTokens }),
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
        ...(tools === undefined ? {} : { tools, tool_choice: 'auto' }),
        ...(req.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
      };
      const stream = await client.chat.completions.create(params, { signal });
      let text = '';
      let model = req.modelId;
      let reason: string | null = null;
      let inputTokens = 0;
      let outputTokens = 0;
      let cachedInputTokens = 0;
      const calls = new Map<number, { id: string; name: string; arguments: string }>();
      const iterator = stream[Symbol.asyncIterator]();
      let keepReading = true;
      while (keepReading) {
        const item = await iterator.next();
        if (item.done) {
          keepReading = false;
          continue;
        }
        const chunk = item.value;
        model = chunk.model || model;
        const choice = chunk.choices[0];
        if (choice !== undefined) {
          if (choice.finish_reason !== null) reason = choice.finish_reason;
          const deltaText = choice.delta.content;
          if (typeof deltaText === 'string' && deltaText.length > 0) {
            emitted = true;
            text += deltaText;
            onDelta(deltaText);
          }
          for (const delta of choice.delta.tool_calls ?? []) {
            const existing = calls.get(delta.index) ?? { id: '', name: '', arguments: '' };
            const updated = {
              id: delta.id ?? existing.id,
              name: delta.function?.name ? existing.name + delta.function.name : existing.name,
              arguments: delta.function?.arguments ? existing.arguments + delta.function.arguments : existing.arguments,
            };
            calls.set(delta.index, updated);
            if (delta.id !== undefined || delta.function?.name !== undefined || delta.function?.arguments !== undefined)
              emitted = true;
          }
        }
        if (chunk.usage !== null && chunk.usage !== undefined) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
          cachedInputTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
          if (reason !== null) {
            stream.controller.abort();
            keepReading = false;
          }
        }
      }
      const parsed = parseToolCalls([...calls.values()]);
      if (!parsed.ok) return { ok: false, error: { ...badRequest(parsed.message), billed: emitted } } as const;
      const result: ProviderResponse = {
        text,
        toolCalls: parsed.calls,
        usage: { inputTokens, outputTokens, cachedInputTokens },
        finishReason: finishReason(reason),
        providerModelId: model,
      };
      return { ok: true, value: result } as const;
    } catch (error) {
      if (signal.aborted) throw error;
      const failure = classifyFailure(error, apiKey);
      return { ok: false, error: { ...failure, billed: emitted } } as const;
    }
  }

  async listModels(apiKey: string, signal: AbortSignal) {
    try {
      const response = await this.client(apiKey).models.list({ signal });
      const ids: string[] = [];
      for await (const model of response) ids.push(model.id);
      return { ok: true, value: ids } as const;
    } catch (error) {
      if (signal.aborted) throw error;
      return { ok: false, error: classifyFailure(error, apiKey) } as const;
    }
  }

  private client(apiKey: string, timeout?: number): OpenAI {
    return new OpenAI({ apiKey, baseURL: this.baseURL, maxRetries: 0, ...(timeout === undefined ? {} : { timeout }) });
  }
}

function badRequest(message: string): ProviderFailure {
  return { kind: FailureKind.BAD_REQUEST, billed: false, message };
}

function classifyFailure(error: unknown, apiKey: string): ProviderFailure {
  if (error instanceof UnsupportedImageError) return badRequest(error.message);
  if (error instanceof APIConnectionTimeoutError) {
    return { kind: FailureKind.TIMEOUT, billed: false, message: 'The provider request timed out.' };
  }
  if (error instanceof APIError) {
    const serializedError: unknown = JSON.parse(JSON.stringify(error)) as unknown;
    const errorRecord = isRecord(serializedError) ? serializedError : {};
    const status = typeof errorRecord.status === 'number' ? errorRecord.status : undefined;
    const code = typeof errorRecord.code === 'string' ? errorRecord.code : '';
    const type = typeof errorRecord.type === 'string' ? errorRecord.type : '';
    const message = error.message.slice(0, 200).replaceAll(apiKey, '[redacted]');
    if (
      status === 429 &&
      (code === 'insufficient_quota' || type === 'insufficient_quota' || /quota|billing/i.test(message))
    ) {
      return { kind: FailureKind.QUOTA_EXHAUSTED, httpStatus: status, billed: false, message };
    }
    if (status === 429) {
      const headers: unknown = error.headers;
      const retryAfterMs = retryAfter(headers instanceof Headers ? headers : undefined);
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

function retryAfter(headers: Headers | undefined): number | undefined {
  if (headers === undefined) return undefined;
  const milliseconds = headers.get('retry-after-ms');
  if (milliseconds !== null && /^\d+(?:\.\d+)?$/.test(milliseconds.trim()))
    return Math.max(0, Math.round(Number(milliseconds)));
  return parseRetryAfter(headers.get('retry-after'), Date.now());
}
