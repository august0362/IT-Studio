import { FailureKind } from '@itstudio/schemas';
import type { ImageGenerationRequest, ImageMimeType, Result } from '@itstudio/schemas';
import type { GeneratedImage } from '../../ports/image-provider.js';
import type { ProviderFailure } from '../../ports/llm-provider.js';

export function dimensions(size: ImageGenerationRequest['args']['size']): readonly [number, number] {
  return size === '1792x1024' ? [1792, 1024] : size === '1024x1792' ? [1024, 1792] : [1024, 1024];
}

export function parseMime(value: string | null): ImageMimeType | undefined {
  const mime = value?.split(';')[0]?.trim().toLowerCase();
  return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp' ? mime : undefined;
}

export async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300).toLowerCase();
  } catch {
    return '';
  }
}

export function classifyStatus(status: number, text: string, signal: AbortSignal): ProviderFailure['kind'] {
  if (signal.aborted) return FailureKind.TIMEOUT;
  if (status === 429 && /quota|billing|insufficient/.test(text)) return FailureKind.QUOTA_EXHAUSTED;
  if (status === 429) return FailureKind.RATE_LIMITED;
  if (status === 401 || status === 403) return FailureKind.AUTH;
  if (/content.?filter|safety|moderation/.test(text)) return FailureKind.CONTENT_FILTERED;
  if (status === 400 || status === 404 || status === 422) return FailureKind.BAD_REQUEST;
  return status >= 500 ? FailureKind.SERVER_ERROR : FailureKind.BAD_REQUEST;
}

export function failure<T = readonly GeneratedImage[]>(
  kind: ProviderFailure['kind'],
  message: string,
  httpStatus?: number,
): Result<T, ProviderFailure> {
  return { ok: false, error: { kind, ...(httpStatus === undefined ? {} : { httpStatus }), billed: false, message } };
}
