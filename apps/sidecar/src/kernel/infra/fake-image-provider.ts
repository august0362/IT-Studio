import { FailureKind, ImageProviderId } from '@itstudio/schemas';
import type { ImageGenerationRequest, ImageProviderId as ImageProviderIdType, Result } from '@itstudio/schemas';
import type { GeneratedImage, IImageProvider } from '../ports/image-provider.js';
import type { ProviderFailure } from '../ports/llm-provider.js';

const PNG_1X1 = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73,
  69, 78, 68, 174, 66, 96, 130,
]);

export class FakeImageProvider implements IImageProvider {
  readonly id: ImageProviderIdType;
  private readonly outcomes: Readonly<Record<string, readonly string[]>>;
  private readonly cursors: Map<string, number>;

  constructor(
    id: ImageProviderIdType = ImageProviderId.OPENAI_DALLE3,
    outcomes: Readonly<Record<string, readonly string[]>> = {},
    cursors: Map<string, number> = new Map<string, number>(),
  ) {
    this.id = id;
    this.outcomes = outcomes;
    this.cursors = cursors;
  }

  generate(request: ImageGenerationRequest): Promise<Result<readonly GeneratedImage[], ProviderFailure>> {
    const script = this.outcomes[this.id] ?? [];
    const cursor = this.cursors.get(this.id) ?? 0;
    this.cursors.set(this.id, cursor + 1);
    const outcome = script[cursor] ?? 'success';
    const failure = /^http:(\d{3})$/u.exec(outcome);
    if (failure?.[1] !== undefined) {
      const status = Number(failure[1]);
      return Promise.resolve({
        ok: false,
        error: {
          kind: status >= 500 ? FailureKind.SERVER_ERROR : FailureKind.BAD_REQUEST,
          billed: false,
          httpStatus: status,
          message: `Scripted image provider HTTP ${String(status)} failure.`,
        },
      });
    }
    return Promise.resolve({
      ok: true,
      value: Array.from({ length: request.args.count ?? 1 }, () => ({ bytes: PNG_1X1, mimeType: 'image/png' })),
    });
  }
}
