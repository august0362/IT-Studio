import { createHash } from 'node:crypto';
import { FailureKind, ProviderId, type Result } from '@itstudio/schemas';
import type { IEmbeddingProvider } from '../ports/embedding-provider.js';
import type { EmbeddingResponse } from '../ports/embedding-provider.js';
import type { ProviderFailure } from '../ports/llm-provider.js';

/** Deterministic, network-free embeddings for E2E and service tests. */
export class FakeEmbeddingProvider implements IEmbeddingProvider {
  readonly id: ProviderId;
  private readonly cursors: Map<string, number>;
  private readonly scripts: Readonly<Record<string, readonly string[]>>;

  constructor(
    id: ProviderId = ProviderId.OPENAI,
    scripts: Readonly<Record<string, readonly string[]>> = {},
    cursors: Map<string, number> = new Map<string, number>(),
  ) {
    this.id = id;
    this.scripts = scripts;
    this.cursors = cursors;
  }

  embed(
    texts: readonly string[],
    request: { readonly modelId: string; readonly dimensions: number },
    apiKey: string,
    signal: AbortSignal,
  ): Promise<Result<EmbeddingResponse, ProviderFailure>> {
    const scriptKey = `${this.id}/${request.modelId}`;
    const cursor = this.cursors.get(scriptKey) ?? 0;
    this.cursors.set(scriptKey, cursor + 1);
    const outcome = this.scripts[scriptKey]?.[cursor] ?? this.scripts[request.modelId]?.[cursor] ?? 'ok';
    if (outcome !== 'ok') return Promise.resolve(scriptedFailure(outcome));
    if (signal.aborted)
      return Promise.resolve({
        ok: false,
        error: { kind: FailureKind.TIMEOUT, billed: false, message: 'Fake embedding request was aborted.' },
      });
    if (apiKey.length === 0)
      return Promise.resolve({
        ok: false,
        error: { kind: FailureKind.AUTH, billed: false, message: 'Fake embedding key is missing.' },
      });
    return Promise.resolve({
      ok: true,
      value: {
        vectors: texts.map((text) => unitVector(text, request.dimensions)),
        inputTokens: texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
      },
    });
  }
}

function scriptedFailure(outcome: string): Result<never, ProviderFailure> {
  if (outcome === 'quota')
    return {
      ok: false,
      error: { kind: FailureKind.QUOTA_EXHAUSTED, billed: false, message: 'Scripted embedding quota failure.' },
    };
  if (outcome === 'auth')
    return {
      ok: false,
      error: {
        kind: FailureKind.AUTH,
        billed: false,
        httpStatus: 401,
        message: 'Scripted embedding authentication failure.',
      },
    };
  const http = /^http:(\d{3})$/u.exec(outcome);
  if (http !== null) {
    const status = Number(http[1]);
    return {
      ok: false,
      error: {
        kind: status === 429 ? FailureKind.RATE_LIMITED : FailureKind.SERVER_ERROR,
        billed: false,
        httpStatus: status,
        message: `Scripted embedding HTTP ${String(status)} failure.`,
      },
    };
  }
  return {
    ok: false,
    error: { kind: FailureKind.SERVER_ERROR, billed: false, message: 'Unknown scripted embedding outcome.' },
  };
}

function unitVector(text: string, dimensions: number): number[] {
  const output: number[] = [];
  let block = 0;
  while (output.length < dimensions) {
    const digest = createHash('sha256').update(text).update(':').update(String(block)).digest();
    for (let offset = 0; offset < digest.length && output.length < dimensions; offset += 4) {
      const value = (digest.readUInt32BE(offset) / 0xffffffff) * 2 - 1;
      output.push(value);
    }
    block += 1;
  }
  const magnitude = Math.sqrt(output.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? output : output.map((value) => value / magnitude);
}
