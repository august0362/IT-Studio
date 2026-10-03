import { expect, it } from 'vitest';
import type { ImageGenerationRequest } from '@itstudio/schemas';
import type { IImageProvider } from '../../ports/image-provider.js';

export const imageRequest: ImageGenerationRequest = {
  projectId: '00000000-0000-4000-8000-000000000001' as ImageGenerationRequest['projectId'],
  args: { prompt: 'a blue house' },
};

export function imageProviderContract(name: string, makeProvider: () => IImageProvider): void {
  it(`${name} satisfies the image provider success contract`, async () => {
    const provider = makeProvider();
    const result = await provider.generate(imageRequest, new AbortController().signal);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected generated images.');
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value[0]?.bytes).toBeInstanceOf(Uint8Array);
    expect(result.value[0]?.bytes.byteLength).toBeGreaterThan(0);
    expect(['image/png', 'image/jpeg', 'image/webp']).toContain(result.value[0]?.mimeType);
  });
}
