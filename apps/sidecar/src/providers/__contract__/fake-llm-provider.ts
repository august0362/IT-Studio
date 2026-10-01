import { FailureKind, ProviderId, type Result } from '@itstudio/schemas';
import type { ILlmProvider, ProviderFailure, ProviderRequest, ProviderResponse } from '../../ports/llm-provider.js';

export interface FakeProviderScript {
  readonly complete?: Result<ProviderResponse, ProviderFailure>;
  readonly stream?: Result<ProviderResponse, ProviderFailure>;
  readonly models?: Result<readonly string[], ProviderFailure>;
  readonly deltas?: readonly string[];
}

function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

export class FakeLlmProvider implements ILlmProvider {
  readonly id = ProviderId.OPENAI;
  private readonly script: FakeProviderScript;

  constructor(script: FakeProviderScript = {}) {
    this.script = script;
  }

  complete(
    req: ProviderRequest,
    _apiKey: string,
    signal: AbortSignal,
  ): Promise<Result<ProviderResponse, ProviderFailure>> {
    if (signal.aborted) return Promise.reject(abortError());
    return Promise.resolve(this.script.complete ?? { ok: true, value: responseFor(req, 'contract response') });
  }

  async stream(
    req: ProviderRequest,
    _apiKey: string,
    signal: AbortSignal,
    onDelta: (text: string) => void,
  ): Promise<Result<ProviderResponse, ProviderFailure>> {
    throwIfAborted(signal);
    const result = this.script.stream ?? { ok: true, value: responseFor(req, 'contract response') };
    if (!result.ok) return result;

    const deltas = this.script.deltas ?? [result.value.text];
    for (const delta of deltas) {
      await Promise.resolve();
      throwIfAborted(signal);
      onDelta(delta);
    }
    return result;
  }

  listModels(_apiKey: string, signal: AbortSignal): Promise<Result<readonly string[], ProviderFailure>> {
    if (signal.aborted) return Promise.reject(abortError());
    return Promise.resolve(this.script.models ?? { ok: true, value: ['fake-model'] });
  }
}

export function responseFor(req: ProviderRequest, text: string): ProviderResponse {
  return {
    text,
    toolCalls: [],
    usage: { inputTokens: 4, outputTokens: 2, cachedInputTokens: 0 },
    finishReason: 'stop',
    providerModelId: req.modelId,
  };
}

export function providerFailure(
  kind: ProviderFailure['kind'],
  extras: Pick<ProviderFailure, 'httpStatus' | 'retryAfterMs'> = {},
): Result<ProviderResponse, ProviderFailure> {
  return {
    ok: false,
    error: { kind, ...extras, billed: false, message: `Scripted ${kind} failure` },
  };
}

export const timeoutFailure = providerFailure(FailureKind.TIMEOUT);
