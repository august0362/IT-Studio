import {
  FailureKind,
  type ImageAsset,
  type ImageGenerationRequest,
  type ImageProviderId,
  type Result,
} from '@itstudio/schemas';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createFakeClock } from '../infra/clock.js';
import { createFakeIdGenerator } from '../infra/id.js';
import { microUsd } from '../domain/money.js';
import type { IFileSystem } from '../ports/file-system.js';
import type { IImageProvider, GeneratedImage } from '../ports/image-provider.js';
import type { ProviderFailure } from '../ports/llm-provider.js';
import type { IImageRepository } from '../ports/image-repository.js';
import type { ILedgerRepository } from '../ports/ledger-repository.js';
import { isoDateTimeSchema, projectIdSchema, priceTableVersionSchema, toolCallIdSchema } from '../validation/brand.js';
import { modelKeySchema } from '../validation/common.js';
import { ImageService } from './image-service.js';

const projectId = projectIdSchema.parse('00000000-0000-4000-8000-000000000001');
const generated: GeneratedImage = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' };

class FakeProvider implements IImageProvider {
  readonly id: ImageProviderId;
  readonly generate = vi.fn<
    (
      request: ImageGenerationRequest,
      signal: AbortSignal,
    ) => Promise<Result<readonly GeneratedImage[], ProviderFailure>>
  >(() => Promise.resolve({ ok: true, value: [generated] }));
  constructor(id: ImageProviderId) {
    this.id = id;
  }
}

function createService(
  options: {
    readonly providers?: readonly IImageProvider[];
    readonly blocking?: boolean;
    readonly budgetFailure?: boolean;
    readonly settingsFailure?: boolean;
    readonly enabled?: boolean;
    readonly providerOrder?: readonly ImageProviderId[];
    readonly price?: number;
    readonly stored?: ImageAsset[];
    readonly fileFailure?: 'mkdir' | 'write' | 'exists' | 'unlink';
  } = {},
) {
  const files = new Map<string, Uint8Array>();
  const rows = options.stored ?? [];
  const inserted: ImageAsset[] = [];
  const repo: IImageRepository = {
    insert: (asset) => {
      inserted.push(asset);
      rows.push(asset);
      return Promise.resolve();
    },
    list: (id) => Promise.resolve(rows.filter((asset) => asset.projectId === id)),
    get: (id) => Promise.resolve(rows.find((asset) => asset.id === id) ?? null),
    delete: (id) => {
      const index = rows.findIndex((asset) => asset.id === id);
      if (index < 0) return Promise.resolve(false);
      rows.splice(index, 1);
      return Promise.resolve(true);
    },
  };
  const ledgerRows: unknown[] = [];
  const ledger = {
    insert: (entry: unknown) => {
      ledgerRows.push(entry);
      return Promise.resolve();
    },
  } as unknown as ILedgerRepository;
  const fs: IFileSystem = {
    readFile: () => Promise.resolve({ ok: true, value: new Uint8Array() }),
    writeFile: (path, data) => {
      if (options.fileFailure === 'write')
        return Promise.resolve({
          ok: false as const,
          error: { code: 'INTERNAL' as const, message: 'disk full', retryable: false },
        });
      files.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data));
      return Promise.resolve({ ok: true, value: undefined });
    },
    rename: () => Promise.resolve({ ok: true, value: undefined }),
    unlink: (path) => {
      if (options.fileFailure === 'unlink')
        return Promise.resolve({
          ok: false as const,
          error: { code: 'INTERNAL' as const, message: 'remove failed', retryable: false },
        });
      files.delete(path);
      return Promise.resolve({ ok: true, value: undefined });
    },
    mkdir: () =>
      Promise.resolve(
        options.fileFailure === 'mkdir'
          ? { ok: false as const, error: { code: 'INTERNAL' as const, message: 'disk full', retryable: false } }
          : { ok: true as const, value: undefined },
      ),
    rmdirIfEmpty: () => Promise.resolve({ ok: true, value: true }),
    stat: () => Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: 'not used', retryable: false } }),
    realpath: (path) => Promise.resolve({ ok: true, value: path }),
    exists: (path) =>
      Promise.resolve(
        options.fileFailure === 'exists'
          ? { ok: false as const, error: { code: 'INTERNAL' as const, message: 'stat failed', retryable: false } }
          : { ok: true as const, value: files.has(path) },
      ),
    readdir: () => Promise.resolve({ ok: true, value: [] }),
    copyFile: () => Promise.resolve({ ok: true, value: undefined }),
    fsync: () => Promise.resolve({ ok: true, value: undefined }),
  };
  const first = options.providers?.[0] ?? new FakeProvider('openai_dalle3');
  const prices = {
    getFxRate: () => ({
      usdToVnd: 25_000,
      asOf: isoDateTimeSchema.parse('2026-10-03T00:00:00.000Z'),
      source: 'auto' as const,
    }),
    getPriceTable: () => ({
      version: priceTableVersionSchema.parse('seed-1'),
      effectiveFrom: isoDateTimeSchema.parse('2026-10-03T00:00:00.000Z'),
      origin: 'seed' as const,
      entries:
        options.price === undefined
          ? []
          : [
              {
                modelKey: modelKeySchema.parse('openai/dall-e-3'),
                inputPerMTokMicroUsd: microUsd(0),
                outputPerMTokMicroUsd: microUsd(0),
                cachedInputPerMTokMicroUsd: microUsd(0),
                perImageMicroUsd: microUsd(options.price),
                freeTier: false,
                sourceUrl: 'https://example.com',
              },
              {
                modelKey: modelKeySchema.parse('together/flux-schnell'),
                inputPerMTokMicroUsd: microUsd(0),
                outputPerMTokMicroUsd: microUsd(0),
                cachedInputPerMTokMicroUsd: microUsd(0),
                perImageMicroUsd: microUsd(options.price),
                freeTier: false,
                sourceUrl: 'https://example.com',
              },
            ],
    }),
  };
  const service = new ImageService({
    repository: repo,
    ledger,
    budget: {
      check: () =>
        Promise.resolve(
          options.budgetFailure
            ? {
                ok: false as const,
                error: { code: 'INTERNAL' as const, message: 'budget unavailable', retryable: false },
              }
            : { ok: true as const, value: { level: 'ok' as const, blocking: options.blocking ?? false } },
        ),
    },
    settings: {
      get: () =>
        Promise.resolve(
          options.settingsFailure
            ? {
                ok: false as const,
                error: { code: 'INTERNAL' as const, message: 'settings unavailable', retryable: false },
              }
            : {
                ok: true as const,
                value: {
                  image: {
                    enabled: options.enabled ?? true,
                    providerOrder: options.providerOrder ?? ['openai_dalle3', 'flux_together'],
                  },
                } as never,
              },
        ),
    },
    providers: options.providers ?? [first],
    prices,
    fileSystem: fs,
    dataDir: 'C:/app-data',
    ids: createFakeIdGenerator([
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000012',
    ]),
    clock: createFakeClock(new Date('2026-10-03T00:00:00.000Z')),
    logger: pino({ enabled: false }),
  });
  return { service, repo, inserted, files, ledgerRows, first, fs };
}

describe('ImageService', () => {
  it('validates arguments before checking budget or calling providers', async () => {
    const h = createService();
    const result = await h.service.generate(
      projectId,
      { prompt: '  ' },
      toolCallIdSchema.parse('call_1'),
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect((h.first as FakeProvider).generate).not.toHaveBeenCalled();
  });

  it('blocks on Hard Stop before any provider call', async () => {
    const h = createService({ blocking: true });
    const result = await h.service.generate(
      projectId,
      { prompt: 'a fox' },
      toolCallIdSchema.parse('call_1'),
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'BUDGET_HARD_STOP' } });
    expect((h.first as FakeProvider).generate).not.toHaveBeenCalled();
    expect(h.files.size).toBe(0);
  });

  it('returns settings and budget errors without dispatching a provider', async () => {
    const settingsFailure = createService({ settingsFailure: true });
    expect(
      await settingsFailure.service.generate(
        projectId,
        { prompt: 'bird' },
        toolCallIdSchema.parse('call_1'),
        new AbortController().signal,
      ),
    ).toMatchObject({ ok: false, error: { message: 'settings unavailable' } });
    const disabled = createService({ enabled: false });
    expect(
      await disabled.service.generate(
        projectId,
        { prompt: 'bird' },
        toolCallIdSchema.parse('call_1'),
        new AbortController().signal,
      ),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    const budgetFailure = createService({ budgetFailure: true });
    expect(
      await budgetFailure.service.generate(
        projectId,
        { prompt: 'bird' },
        toolCallIdSchema.parse('call_1'),
        new AbortController().signal,
      ),
    ).toMatchObject({ ok: false, error: { message: 'budget unavailable' } });
    expect((budgetFailure.first as FakeProvider).generate).not.toHaveBeenCalled();
  });

  it('handles cancellation and provider ladders without available candidates', async () => {
    const cancelled = createService();
    const controller = new AbortController();
    controller.abort();
    expect(
      await cancelled.service.generate(
        projectId,
        { prompt: 'bird' },
        toolCallIdSchema.parse('call_1'),
        controller.signal,
      ),
    ).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    const noProvider = createService({ providerOrder: ['midjourney_proxy'] });
    expect(
      await noProvider.service.generate(
        projectId,
        { prompt: 'bird' },
        toolCallIdSchema.parse('call_1'),
        new AbortController().signal,
      ),
    ).toMatchObject({ ok: false, error: { code: 'LADDER_EXHAUSTED' } });
  });

  it('skips empty provider responses and stops on non-fallback failures', async () => {
    const empty = new FakeProvider('openai_dalle3');
    empty.generate.mockResolvedValue({ ok: true, value: [] });
    expect(
      await createService({ providers: [empty] }).service.generate(
        projectId,
        { prompt: 'bird' },
        toolCallIdSchema.parse('call_1'),
        new AbortController().signal,
      ),
    ).toMatchObject({ ok: false });
    const auth = new FakeProvider('openai_dalle3');
    auth.generate.mockResolvedValue({
      ok: false,
      error: { kind: FailureKind.AUTH, billed: false, message: 'rejected' },
    });
    expect(
      await createService({ providers: [auth] }).service.generate(
        projectId,
        { prompt: 'bird' },
        toolCallIdSchema.parse('call_1'),
        new AbortController().signal,
      ),
    ).toMatchObject({ ok: false, error: { code: 'PROVIDER_AUTH' } });
  });

  it('lists assets and deletes the stored file and row', async () => {
    const h = createService();
    const created = await h.service.generate(
      projectId,
      { prompt: 'remove this image' },
      toolCallIdSchema.parse('call_1'),
      new AbortController().signal,
    );
    if (!created.ok) throw new Error('Image fixture could not be created.');
    const [assetId] = created.value.assetIds;
    if (assetId === undefined) throw new Error('Created image id is missing.');
    expect(await h.service.list(projectId)).toMatchObject({ ok: true, value: [{ id: assetId }] });
    expect(await h.service.delete(assetId)).toEqual({ ok: true, value: { deleted: true } });
    expect(h.files.size).toBe(0);
    expect(await h.service.list(projectId)).toEqual({ ok: true, value: [] });
    expect(await h.service.delete(assetId)).toEqual({ ok: true, value: { deleted: false } });
  });

  it('reports incomplete results and handles image storage and delete failures', async () => {
    const incompleteProvider = new FakeProvider('openai_dalle3');
    incompleteProvider.generate.mockResolvedValue({
      ok: true,
      value: [{ bytes: new Uint8Array([1]), mimeType: 'image/jpeg', revisedPrompt: 'revised' }],
    });
    const incomplete = createService({ providers: [incompleteProvider] });
    const partial = await incomplete.service.generate(
      projectId,
      { prompt: 'two images', count: 2 },
      toolCallIdSchema.parse('call_1'),
      new AbortController().signal,
    );
    expect(partial).toMatchObject({
      ok: false,
      error: { details: { assetIds: ['00000000-0000-4000-8000-000000000010'] } },
    });
    expect(incomplete.inserted[0]?.localPath.endsWith('.jpg')).toBe(true);
    expect(incomplete.inserted[0]?.revisedPrompt).toBe('revised');

    for (const fileFailure of ['mkdir', 'write'] as const) {
      const failedStorage = createService({ fileFailure });
      expect(
        await failedStorage.service.generate(
          projectId,
          { prompt: 'storage error' },
          toolCallIdSchema.parse('call_1'),
          new AbortController().signal,
        ),
      ).toMatchObject({ ok: false, error: { message: 'disk full' } });
    }

    const source = createService();
    const stored = await source.service.generate(
      projectId,
      { prompt: 'delete failure' },
      toolCallIdSchema.parse('call_1'),
      new AbortController().signal,
    );
    if (!stored.ok) throw new Error('Image fixture could not be created.');
    const asset = source.inserted[0];
    if (asset === undefined) throw new Error('Stored image fixture was missing.');
    const existenceFailure = createService({ stored: [asset], fileFailure: 'exists' });
    expect(await existenceFailure.service.delete(asset.id)).toMatchObject({
      ok: false,
      error: { message: 'stat failed' },
    });
    const unlinkFailure = createService({ stored: [asset], fileFailure: 'unlink' });
    unlinkFailure.files.set(asset.localPath, new Uint8Array([1]));
    expect(await unlinkFailure.service.delete(asset.id)).toMatchObject({
      ok: false,
      error: { message: 'remove failed' },
    });
  });

  it('falls back in configured order and stores image bytes under generated ids', async () => {
    const unavailable = new FakeProvider('openai_dalle3');
    unavailable.generate.mockResolvedValue({
      ok: false,
      error: { kind: FailureKind.RATE_LIMITED, billed: false, message: 'limited' },
    });
    const fallback = new FakeProvider('flux_together');
    const h = createService({ providers: [unavailable, fallback], price: 7 });
    const result = await h.service.generate(
      projectId,
      { prompt: 'a fox', count: 1 },
      toolCallIdSchema.parse('call_1'),
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: true, value: { assetIds: ['00000000-0000-4000-8000-000000000010'] } });
    expect(unavailable.generate).toHaveBeenCalledTimes(1);
    expect(fallback.generate).toHaveBeenCalledTimes(1);
    expect(h.inserted[0]?.localPath).toMatch(
      /images[\\/]00000000-0000-4000-8000-000000000001[\\/]00000000-0000-4000-8000-000000000010\.png$/u,
    );
    expect(h.ledgerRows).toMatchObject([{ purpose: 'image', imageCount: 1, costMicroUsd: 7 }]);
  });

  it('keeps and reports stored assets after a later storage failure', async () => {
    const provider = new FakeProvider('openai_dalle3');
    provider.generate.mockResolvedValue({ ok: true, value: [generated, generated] });
    const h = createService({ providers: [provider] });
    let writes = 0;
    const originalInsert = h.repo.insert.bind(h.repo);
    h.repo.insert = async (asset) => {
      writes += 1;
      if (writes > 1) throw new Error('db unavailable');
      await originalInsert(asset);
    };
    const result = await h.service.generate(
      projectId,
      { prompt: 'two images', count: 2 },
      toolCallIdSchema.parse('call_1'),
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { details: { assetIds: ['00000000-0000-4000-8000-000000000010'] } },
    });
    expect(h.ledgerRows).toMatchObject([{ purpose: 'image', imageCount: 1 }]);
  });
});
