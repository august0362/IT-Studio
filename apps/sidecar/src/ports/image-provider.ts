import type { AppError, ImageGenerationRequest, ImageMimeType, ImageProviderId, Result } from '@itstudio/schemas';
import type { ProviderFailure } from './llm-provider.js';

export interface GeneratedImage {
  readonly bytes: Uint8Array;
  readonly mimeType: ImageMimeType;
  readonly revisedPrompt?: string;
}

export interface IImageProvider {
  readonly id: ImageProviderId;
  generate(
    req: ImageGenerationRequest,
    signal: AbortSignal,
  ): Promise<Result<readonly GeneratedImage[], ProviderFailure | AppError>>;
}
