import { z } from 'zod';
import { FailureKind, ImageProviderId, ProviderId } from '@itstudio/schemas';
import type { ImageGenerationRequest, ImageMimeType, Result } from '@itstudio/schemas';
import type { IHttpClient } from '../../ports/http-client.js';
import type { ISecretStore } from '../../ports/secret-store.js';
import type { GeneratedImage, IImageProvider } from '../../ports/image-provider.js';
import type { ProviderFailure } from '../../ports/llm-provider.js';

const MODEL_ENDPOINT = 'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions';
const MAX_BYTES = 20 * 1024 * 1024;
const predictionSchema = z.object({
  status: z.enum(['starting', 'processing', 'succeeded', 'failed', 'canceled']),
  output: z
    .union([z.url(), z.array(z.url())])
    .nullable()
    .optional(),
  error: z.string().nullable().optional(),
  urls: z.object({ get: z.url() }).optional(),
});

export interface ReplicatePollingOptions {
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export class FluxReplicateProvider implements IImageProvider {
  readonly id = ImageProviderId.FLUX_REPLICATE;
  private readonly secrets: ISecretStore;
  private readonly http: IHttpClient;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;

  constructor(secrets: ISecretStore, http: IHttpClient, options: ReplicatePollingOptions = {}) {
    this.secrets = secrets;
    this.http = http;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.wait = options.wait ?? abortableWait;
  }

  async generate(
    req: ImageGenerationRequest,
    signal: AbortSignal,
  ): Promise<Result<readonly GeneratedImage[], ProviderFailure>> {
    const stored = await this.secrets.get(ProviderId.REPLICATE);
    if (!stored.ok || stored.value === null)
      return failure(FailureKind.AUTH, 'Replicate image credentials are unavailable.');
    try {
      const results: GeneratedImage[] = [];
      for (let index = 0; index < (req.args.count ?? 1); index += 1) {
        const prediction = await this.create(req, stored.value, signal);
        if (!prediction.ok) return prediction;
        const images = await this.waitForPrediction(prediction.value, stored.value, signal);
        if (!images.ok) return images;
        results.push(...images.value);
      }
      return { ok: true, value: results };
    } catch {
      return {
        ok: false,
        error: {
          kind: signal.aborted ? FailureKind.TIMEOUT : FailureKind.SERVER_ERROR,
          billed: false,
          message: 'The Replicate image request failed.',
        },
      };
    }
  }

  private async create(
    req: ImageGenerationRequest,
    key: string,
    signal: AbortSignal,
  ): Promise<Result<z.infer<typeof predictionSchema>, ProviderFailure>> {
    const [width, height] = dimensions(req.args.size);
    const response = await this.http.request(MODEL_ENDPOINT, {
      method: 'POST',
      signal,
      headers: auth(key),
      body: JSON.stringify({
        input: { prompt: req.args.prompt, aspect_ratio: ratio(width, height), output_format: 'png' },
      }),
    });
    if (!response.ok)
      return failure(
        classifyStatus(response.status, await safeText(response), signal),
        'Replicate rejected the image request.',
        response.status,
      );
    const parsed = predictionSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.urls?.get === undefined)
      return failure(FailureKind.BAD_REQUEST, 'Replicate returned an invalid prediction.');
    return { ok: true, value: parsed.data };
  }

  private async waitForPrediction(
    initial: z.infer<typeof predictionSchema>,
    key: string,
    signal: AbortSignal,
  ): Promise<Result<readonly GeneratedImage[], ProviderFailure>> {
    const started = Date.now();
    let prediction = initial;
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
      if (signal.aborted) return failure(FailureKind.TIMEOUT, 'The Replicate image request was cancelled.');
      if (Date.now() - started >= this.timeoutMs)
        return failure(FailureKind.TIMEOUT, 'Replicate image generation timed out.');
      await this.wait(Math.min(this.pollIntervalMs, Math.max(1, this.timeoutMs - (Date.now() - started))), signal);
      const response = await this.http.request(prediction.urls?.get ?? '', { signal, headers: auth(key) });
      if (!response.ok)
        return failure(
          classifyStatus(response.status, await safeText(response), signal),
          'Replicate prediction polling failed.',
          response.status,
        );
      const parsed = predictionSchema.safeParse(await response.json());
      if (!parsed.success) return failure(FailureKind.BAD_REQUEST, 'Replicate returned an invalid prediction.');
      prediction = parsed.data;
    }
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      const detail = prediction.error?.toLowerCase() ?? '';
      return failure(
        /content.?filter|safety|moderation/.test(detail) ? FailureKind.CONTENT_FILTERED : FailureKind.SERVER_ERROR,
        'Replicate image generation did not succeed.',
      );
    }
    const urls =
      prediction.output === undefined || prediction.output === null
        ? []
        : typeof prediction.output === 'string'
          ? [prediction.output]
          : prediction.output;
    const images: GeneratedImage[] = [];
    for (const url of urls) {
      const image = await this.download(url, key, signal);
      if (!image.ok) return image;
      images.push(image.value);
    }
    return images.length === 0
      ? failure(FailureKind.BAD_REQUEST, 'Replicate returned no generated images.')
      : { ok: true, value: images };
  }

  private async download(
    url: string,
    key: string,
    signal: AbortSignal,
  ): Promise<Result<GeneratedImage, ProviderFailure>> {
    const response = await this.http.request(url, { signal, headers: auth(key) });
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
    return mimeType === undefined
      ? failure(FailureKind.BAD_REQUEST, 'Replicate returned an unsupported image type.')
      : { ok: true, value: { bytes, mimeType } };
  }
}

function auth(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}
function dimensions(size: ImageGenerationRequest['args']['size']): readonly [number, number] {
  return size === '1792x1024' ? [1792, 1024] : size === '1024x1792' ? [1024, 1792] : [1024, 1024];
}
function ratio(width: number, height: number): string {
  return width > height ? '16:9' : width < height ? '9:16' : '1:1';
}
function parseMime(value: string | null): ImageMimeType | undefined {
  const mime = value?.split(';')[0]?.trim().toLowerCase();
  return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp' ? mime : undefined;
}
async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300).toLowerCase();
  } catch {
    return '';
  }
}
function classifyStatus(status: number, text: string, signal: AbortSignal): ProviderFailure['kind'] {
  if (signal.aborted) return FailureKind.TIMEOUT;
  if (status === 429 && /quota|billing|insufficient/.test(text)) return FailureKind.QUOTA_EXHAUSTED;
  if (status === 429) return FailureKind.RATE_LIMITED;
  if (status === 401 || status === 403) return FailureKind.AUTH;
  if (/content.?filter|safety|moderation/.test(text)) return FailureKind.CONTENT_FILTERED;
  if (status === 400 || status === 404 || status === 422) return FailureKind.BAD_REQUEST;
  return status >= 500 ? FailureKind.SERVER_ERROR : FailureKind.BAD_REQUEST;
}
function failure<T = readonly GeneratedImage[]>(
  kind: ProviderFailure['kind'],
  message: string,
  httpStatus?: number,
): Result<T, ProviderFailure> {
  return { ok: false, error: { kind, ...(httpStatus === undefined ? {} : { httpStatus }), billed: false, message } };
}
function abortableWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}
