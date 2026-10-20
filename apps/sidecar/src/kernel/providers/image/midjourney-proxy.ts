import { ErrorCode, ImageProviderId } from '@itstudio/schemas';
import type { Result } from '@itstudio/schemas';
import type { IImageProvider, GeneratedImage } from '../../ports/image-provider.js';

export class MidjourneyProxyProvider implements IImageProvider {
  readonly id = ImageProviderId.MIDJOURNEY_PROXY;

  generate(): Promise<Result<readonly GeneratedImage[]>> {
    return Promise.resolve({
      ok: false,
      error: {
        code: ErrorCode.VALIDATION,
        message: 'Midjourney image generation is disabled and requires an ADR and user consent (ToS).',
        remediation: ['Choose an enabled image provider.'],
        retryable: false,
      },
    });
  }
}
