import OpenAI from 'openai';
import { z } from 'zod';
import { FailureKind, ImageProviderId, ProviderId } from '@itstudio/schemas';
import type { ImageGenerationRequest, ImageSize, Result } from '@itstudio/schemas';
import type { ISecretStore } from '../../ports/secret-store.js';
import type { GeneratedImage, IImageProvider } from '../../ports/image-provider.js';
import type { ProviderFailure } from '../../ports/llm-provider.js';

const MAX_BYTES = 20 * 1024 * 1024;
const imageItem = z.object({ b64_json: z.string().optional(), revised_prompt: z.string().optional() });
const responseSchema = z.object({ data: z.array(imageItem) });
type Generate = (input: { apiKey: string; prompt: string; size: ImageSize; signal: AbortSignal }) => Promise<unknown>;

export class OpenAiDalle3Provider implements IImageProvider {
  readonly id = ImageProviderId.OPENAI_DALLE3;
  private readonly secrets: ISecretStore;
  private readonly generateSdk: Generate | undefined;

  constructor(secrets: ISecretStore, generateSdk?: Generate) {
    this.secrets = secrets;
    this.generateSdk = generateSdk;
  }

  async generate(
    req: ImageGenerationRequest,
    signal: AbortSignal,
  ): Promise<Result<readonly GeneratedImage[], ProviderFailure>> {
    const storedKey = await this.secrets.get(ProviderId.OPENAI);
    if (!storedKey.ok || storedKey.value === null)
      return fail(FailureKind.AUTH, 'OpenAI image credentials are unavailable.');
    const images: GeneratedImage[] = [];
    try {
      for (let index = 0; index < (req.args.count ?? 1); index += 1) {
        const raw = await this.generateWithKey(storedKey.value, req.args.prompt, req.args.size ?? '1024x1024', signal);
        const parsed = responseSchema.parse(raw);
        const item = parsed.data[0];
        if (item?.b64_json === undefined) return fail(FailureKind.BAD_REQUEST, 'OpenAI returned no encoded image.');
        if (Math.floor((item.b64_json.length * 3) / 4) > MAX_BYTES)
          return fail(FailureKind.BAD_REQUEST, 'The generated image exceeded the 20 MB limit.');
        const bytes = Buffer.from(item.b64_json, 'base64');
        if (bytes.byteLength > MAX_BYTES)
          return fail(FailureKind.BAD_REQUEST, 'The generated image exceeded the 20 MB limit.');
        images.push({
          bytes,
          mimeType: 'image/png',
          ...(item.revised_prompt === undefined ? {} : { revisedPrompt: item.revised_prompt }),
        });
      }
      return { ok: true, value: images };
    } catch (error) {
      return { ok: false, error: classify(error, signal) };
    }
  }

  private async generateWithKey(key: string, prompt: string, size: ImageSize, signal: AbortSignal): Promise<unknown> {
    if (this.generateSdk !== undefined) return this.generateSdk({ apiKey: key, prompt, size, signal });
    return new OpenAI({ apiKey: key, maxRetries: 0 }).images.generate(
      { model: 'dall-e-3', prompt, n: 1, size, response_format: 'b64_json' },
      { signal },
    );
  }
}

function fail(kind: ProviderFailure['kind'], message: string): Result<readonly GeneratedImage[], ProviderFailure> {
  return { ok: false, error: { kind, billed: false, message } };
}
function classify(error: unknown, signal: AbortSignal): ProviderFailure {
  if (signal.aborted || (error instanceof Error && error.name === 'APIConnectionTimeoutError'))
    return { kind: FailureKind.TIMEOUT, billed: false, message: 'The image request timed out or was cancelled.' };
  if (error instanceof OpenAI.APIError) {
    const rawStatus: unknown = Object.getOwnPropertyDescriptor(error, 'status')?.value;
    const status = typeof rawStatus === 'number' ? rawStatus : undefined;
    const message = error.message.toLowerCase();
    if (status === 429 && /quota|billing|insufficient_quota/.test(message))
      return {
        kind: FailureKind.QUOTA_EXHAUSTED,
        httpStatus: status,
        billed: false,
        message: 'The image provider quota is exhausted.',
      };
    if (status === 429)
      return {
        kind: FailureKind.RATE_LIMITED,
        httpStatus: status,
        billed: false,
        message: 'The image provider is rate limited.',
      };
    if (status === 401 || status === 403)
      return {
        kind: FailureKind.AUTH,
        httpStatus: status,
        billed: false,
        message: 'The image provider rejected its credentials.',
      };
    if (/content.?filter|safety|moderation/.test(message))
      return {
        kind: FailureKind.CONTENT_FILTERED,
        ...(status === undefined ? {} : { httpStatus: status }),
        billed: false,
        message: 'The image prompt was blocked by the provider safety filter.',
      };
    if ([400, 404, 422].includes(status ?? 0))
      return {
        kind: FailureKind.BAD_REQUEST,
        ...(status === undefined ? {} : { httpStatus: status }),
        billed: false,
        message: 'The image request was rejected as invalid.',
      };
    return {
      kind: FailureKind.SERVER_ERROR,
      ...(status === undefined ? {} : { httpStatus: status }),
      billed: false,
      message: 'The image provider is unavailable.',
    };
  }
  if (error instanceof z.ZodError)
    return {
      kind: FailureKind.BAD_REQUEST,
      billed: false,
      message: 'The image provider returned an invalid response.',
    };
  return { kind: FailureKind.SERVER_ERROR, billed: false, message: 'The image provider request failed.' };
}
