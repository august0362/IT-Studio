import { ImageProviderId } from '@itstudio/schemas';
import type { ImageGenerationRequest, Result } from '@itstudio/schemas';
import type { GeneratedImage, IImageProvider } from '../ports/image-provider.js';

const PNG_1X1 = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73,
  69, 78, 68, 174, 66, 96, 130,
]);

export class FakeImageProvider implements IImageProvider {
  readonly id = ImageProviderId.OPENAI_DALLE3;

  generate(request: ImageGenerationRequest): Promise<Result<readonly GeneratedImage[]>> {
    return Promise.resolve({
      ok: true,
      value: Array.from({ length: request.args.count ?? 1 }, () => ({ bytes: PNG_1X1, mimeType: 'image/png' })),
    });
  }
}
