import { createHash } from 'node:crypto';
import { FailureKind, ProviderId, type Result } from '@itstudio/schemas';
import type { IEmbeddingProvider } from '../ports/embedding-provider.js';
import type { EmbeddingResponse } from '../ports/embedding-provider.js';
import type { ProviderFailure } from '../ports/llm-provider.js';

/** Deterministic, network-free embeddings for E2E and service tests. */
export class FakeEmbeddingProvider implements IEmbeddingProvider {
  readonly id: ProviderId;

  constructor(id: ProviderId = ProviderId.OPENAI) {
    this.id = id;
  }

  embed(
    texts: readonly string[],
    request: { readonly modelId: string; readonly dimensions: number },
    apiKey: string,
    signal: AbortSignal,
  ): Promise<Result<EmbeddingResponse, ProviderFailure>> {
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
