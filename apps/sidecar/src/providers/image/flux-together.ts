import { z } from 'zod';
import { FailureKind, ImageProviderId, ProviderId } from '@itstudio/schemas';
import type { ImageGenerationRequest, Result } from '@itstudio/schemas';
import type { IHttpClient } from '../../ports/http-client.js';
import type { ISecretStore } from '../../ports/secret-store.js';
import type { GeneratedImage, IImageProvider } from '../../ports/image-provider.js';
import type { ProviderFailure } from '../../ports/llm-provider.js';
import { classifyStatus, dimensions, failure, parseMime, safeText } from './flux-helpers.js';

const ENDPOINT = 'https://api.together.xyz/v1/images/generations';
const MAX_BYTES = 20 * 1024 * 1024;
const responseSchema = z.object({
  data: z.array(z.object({ url: z.url().optional(), b64_json: z.string().optional() })),
});

export class FluxTogetherProvider implements IImageProvider {
  readonly id = ImageProviderId.FLUX_TOGETHER;
  private readonly secrets: ISecretStore;
  private readonly http: IHttpClient;

  constructor(secrets: ISecretStore, http: IHttpClient) {
    this.secrets = secrets;
    this.http = http;
  }

  async generate(
    req: ImageGenerationRequest,
    signal: AbortSignal,
  ): Promise<Result<readonly GeneratedImage[], ProviderFailure>> {
    const stored = await this.secrets.get(ProviderId.TOGETHER);
    if (!stored.ok || stored.value === null)
      return failure(FailureKind.AUTH, 'Together image credentials are unavailable.');
    const images: GeneratedImage[] = [];
    try {
      for (let index = 0; index < (req.args.count ?? 1); index += 1) {
        const response = await this.http.request(ENDPOINT, {
          method: 'POST',
          signal,
          headers: { authorization: `Bearer ${stored.value}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'black-forest-labs/FLUX.1-schnell',
            prompt: req.args.prompt,
            width: dimensions(req.args.size)[0],
            height: dimensions(req.args.size)[1],
            steps: 4,
            n: 1,
          }),
        });
        if (!response.ok)
          return failure(
            classifyStatus(response.status, await safeText(response), signal),
            statusMessage(response.status),
            response.status,
          );
        const parsed = responseSchema.safeParse(await response.json());
        if (!parsed.success || parsed.data.data[0] === undefined)
          return failure(FailureKind.BAD_REQUEST, 'Together returned an invalid image response.');
        const item = parsed.data.data[0];
        if (item.b64_json !== undefined) {
          const bytes = decodeBase64(item.b64_json);
          if (bytes === undefined)
            return failure(FailureKind.BAD_REQUEST, 'The generated image exceeded the 20 MB limit.');
          images.push({ bytes, mimeType: 'image/png' });
        } else if (item.url !== undefined) {
          const image = await this.download(item.url, signal);
          if (!image.ok) return image;
          images.push(image.value);
        } else return failure(FailureKind.BAD_REQUEST, 'Together returned no image data.');
      }
      return { ok: true, value: images };
    } catch (error) {
      return { ok: false, error: classifyError(error, signal) };
    }
  }

  private async download(url: string, signal: AbortSignal): Promise<Result<GeneratedImage, ProviderFailure>> {
    const response = await this.http.request(url, { signal });
    if (!response.ok)
      return failure(
        classifyStatus(response.status, await safeText(response), signal),
        'The generated image could not be downloaded.',
        response.status,
      );
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_BYTES)
      return failure(FailureKind.BAD_REQUEST, 'The generated image exceeded the 20 MB limit.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES)
      return failure(FailureKind.BAD_REQUEST, 'The generated image exceeded the 20 MB limit.');
    const mimeType = parseMime(response.headers.get('content-type'));
    if (mimeType === undefined)
      return failure(FailureKind.BAD_REQUEST, 'The provider returned an unsupported image type.');
    return { ok: true, value: { bytes, mimeType } };
  }
}

function decodeBase64(value: string): Uint8Array | undefined {
  if (Math.floor((value.length * 3) / 4) > MAX_BYTES) return undefined;
  const bytes = Buffer.from(value, 'base64');
  return bytes.byteLength > MAX_BYTES ? undefined : bytes;
}
function classifyError(error: unknown, signal: AbortSignal): ProviderFailure {
  return {
    kind: signal.aborted ? FailureKind.TIMEOUT : FailureKind.SERVER_ERROR,
    billed: false,
    message: error instanceof Error ? 'The Together image request failed.' : 'The Together image request failed.',
  };
}
function statusMessage(status: number): string {
  if (status === 401 || status === 403) return 'Together rejected its credentials.';
  if (status === 429) return 'Together image quota or rate limit was reached.';
  if (status >= 500) return 'Together image generation is temporarily unavailable.';
  return 'Together rejected the image request.';
}
