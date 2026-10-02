import type { ProviderId, Result } from '@itstudio/schemas';
import type { ProviderFailure } from './llm-provider.js';

export interface EmbeddingRequest {
  readonly modelId: string;
  readonly dimensions: number;
}

export interface EmbeddingResponse {
  readonly vectors: number[][];
  readonly inputTokens: number;
}

export interface IEmbeddingProvider {
  readonly id: ProviderId;
  embed(
    texts: readonly string[],
    request: EmbeddingRequest,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<Result<EmbeddingResponse, ProviderFailure>>;
}
