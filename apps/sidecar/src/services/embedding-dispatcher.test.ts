import { EventBus } from '../rpc/event-bus.js';
import { MemorySecretStore } from '../infra/memory-secret-store.js';
import type { IEmbeddingProvider } from '../ports/embedding-provider.js';
import type { ISecretStore } from '../ports/secret-store.js';
import type { RouterCompleted } from './llm-router.js';
import { projectIdSchema } from '../validation/brand.js';
import { FailureKind, ProviderId, type EmbeddingConfig, type ModelDescriptor } from '@itstudio/schemas';
import { describe, expect, it, vi } from 'vitest';
import { EmbeddingDispatcher, type EmbeddingDispatcherDependencies } from './embedding-dispatcher.js';

const projectId = projectIdSchema.parse('00000000-0000-4000-8000-000000000001');
const models: readonly ModelDescriptor[] = [
  {
    key: 'openai/text-embedding-3-small',
    provider: ProviderId.OPENAI,
    providerModelId: 'text-embedding-3-small',
    displayName: 'OpenAI embeddings',
    capabilities: ['embedding'],
    contextWindowTokens: 8191,
    maxOutputTokens: 0,
    enabled: true,
  },
  {
    key: 'google/gemini-embedding-2',
    provider: ProviderId.GOOGLE,
    providerModelId: 'gemini-embedding-2',
    displayName: 'Gemini embeddings',
    capabilities: ['embedding'],
    contextWindowTokens: 8192,
    maxOutputTokens: 0,
    enabled: true,
  },
];
const config: EmbeddingConfig = {
  modelKey: 'openai/text-embedding-3-small',
  dimensions: 2,
  batchSize: 64,
  fallbackModelKeys: ['google/gemini-embedding-2'],
};
const apiKey = 'test-key';
const id = '00000000-0000-4000-8000-000000000002';

function provider(providerId: ProviderId, embed: IEmbeddingProvider['embed']): IEmbeddingProvider {
  return { id: providerId, embed };
}

function harness(overrides: {
  readonly openai: IEmbeddingProvider['embed'];
  readonly google?: IEmbeddingProvider['embed'];
  readonly batchSize?: number;
  readonly models?: readonly ModelDescriptor[];
  readonly config?: Partial<EmbeddingConfig>;
  readonly providers?: EmbeddingDispatcherDependencies['providers'];
  readonly secrets?: ISecretStore;
  readonly useDefaultTiming?: boolean;
}) {
  const completed = new EventBus<{ completed: RouterCompleted }>();
  const events: RouterCompleted[] = [];
  completed.subscribe('completed', (event) => events.push(event));
  const secrets = new MemorySecretStore();
  void secrets.set(ProviderId.OPENAI, apiKey);
  void secrets.set(ProviderId.GOOGLE, apiKey);
  let sequence = 0;
  const dispatcher = new EmbeddingDispatcher({
    config: {
      ...config,
      ...(overrides.batchSize === undefined ? {} : { batchSize: overrides.batchSize }),
      ...overrides.config,
    },
    models: overrides.models ?? models,
    providers: overrides.providers ?? {
      [ProviderId.OPENAI]: provider(ProviderId.OPENAI, overrides.openai),
      [ProviderId.GOOGLE]: provider(
        ProviderId.GOOGLE,
        overrides.google ??
          ((texts) =>
            Promise.resolve({ ok: true, value: { vectors: texts.map(() => [0, 2]), inputTokens: texts.length } })),
      ),
    },
    secrets: overrides.secrets ?? secrets,
    ids: {
      uuid: () => {
        sequence += 1;
        return sequence === 1 ? id : '00000000-0000-4000-8000-000000000003';
      },
    },
    completed,
    ...(overrides.useDefaultTiming ? {} : { sleep: () => Promise.resolve(), random: () => 0.5 }),
  });
  return { dispatcher, events };
}

describe('EmbeddingDispatcher', () => {
  it('returns empty input without provider calls and rejects oversized texts', async () => {
    const openai = vi.fn<IEmbeddingProvider['embed']>(() =>
      Promise.resolve({ ok: true, value: { vectors: [], inputTokens: 0 } }),
    );
    const { dispatcher, events } = harness({ openai });
    await expect(dispatcher.embed([], { projectId, purpose: 'embedding' })).resolves.toEqual({ ok: true, value: [] });
    const oversized = await dispatcher.embed(['x'.repeat(32_005)], { projectId, purpose: 'embedding' });
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) expect(oversized.error.message).toContain('8,000 estimated token limit');
    expect(openai).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it('batches inputs, normalises vectors, and publishes one completion per batch', async () => {
    const openai = vi.fn<IEmbeddingProvider['embed']>((texts) =>
      Promise.resolve({ ok: true, value: { vectors: texts.map(() => [3, 4]), inputTokens: texts.length * 2 } }),
    );
    const { dispatcher, events } = harness({ openai });
    const result = await dispatcher.embed(
      Array.from({ length: 130 }, () => 'text'),
      { projectId, purpose: 'embedding' },
    );
    expect(openai).toHaveBeenCalledTimes(3);
    expect(openai.mock.calls.map(([texts]) => texts.length)).toEqual([64, 64, 2]);
    expect(result).toMatchObject({ ok: true, value: Array.from({ length: 130 }, () => [0.6, 0.8]) });
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      projectId,
      purpose: 'embedding',
      modelKey: config.modelKey,
      usage: { inputTokens: 128, outputTokens: 0, cachedInputTokens: 0 },
    });
  });

  it('retries transient failures then falls back and records the successful model', async () => {
    const openai = vi.fn<IEmbeddingProvider['embed']>(() =>
      Promise.resolve({
        ok: false,
        error: { kind: FailureKind.RATE_LIMITED, httpStatus: 429, billed: false, message: 'slow down' },
      }),
    );
    const google = vi.fn<IEmbeddingProvider['embed']>((texts) =>
      Promise.resolve({ ok: true, value: { vectors: texts.map(() => [0, 2]), inputTokens: 4 } }),
    );
    const { dispatcher, events } = harness({ openai, google });
    const result = await dispatcher.embed(['fallback'], { projectId, purpose: 'embedding' });
    expect(result).toMatchObject({ ok: true, value: [[0, 1]] });
    expect(openai).toHaveBeenCalledTimes(3);
    expect(google).toHaveBeenCalledOnce();
    expect(events[0]).toMatchObject({ modelKey: 'google/gemini-embedding-2', usage: { inputTokens: 4 } });
  });

  it('fails fast on authentication errors without exposing provider keys', async () => {
    const openai = vi.fn<IEmbeddingProvider['embed']>(() =>
      Promise.resolve({
        ok: false,
        error: { kind: FailureKind.AUTH, httpStatus: 401, billed: false, message: `invalid ${apiKey}` },
      }),
    );
    const google = vi.fn<IEmbeddingProvider['embed']>();
    const { dispatcher } = harness({ openai, google });
    const result = await dispatcher.embed(['text'], { projectId, purpose: 'embedding' });
    expect(result).toMatchObject({ ok: false, error: { code: 'PROVIDER_AUTH' } });
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(openai).toHaveBeenCalledOnce();
    expect(google).not.toHaveBeenCalled();
  });

  it('surfaces a clear internal error when a provider returns the wrong dimensions', async () => {
    const openai = vi.fn<IEmbeddingProvider['embed']>(() =>
      Promise.resolve({
        ok: false,
        error: {
          kind: FailureKind.BAD_REQUEST,
          billed: false,
          message: 'Embedding provider returned a vector with dimensions that did not match the requested 2.',
        },
      }),
    );
    const { dispatcher } = harness({ openai });
    const result = await dispatcher.embed(['text'], { projectId, purpose: 'embedding' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_BAD_REQUEST');
      expect(result.error.message).toContain('requested 2');
    }
  });

  it('validates batch size and handles missing credentials or a failed secret store', async () => {
    const openai = vi.fn<IEmbeddingProvider['embed']>(() =>
      Promise.resolve({ ok: true, value: { vectors: [[1, 0]], inputTokens: 1 } }),
    );
    const invalidBatch = await harness({ openai, batchSize: 0 }).dispatcher.embed(['text'], {
      projectId,
      purpose: 'embedding',
    });
    expect(invalidBatch.ok).toBe(false);
    if (!invalidBatch.ok) expect(invalidBatch.error.code).toBe('VALIDATION');

    const missingKeyStore: ISecretStore = {
      get: () => Promise.resolve({ ok: true, value: null }),
      set: () => Promise.resolve({ ok: true, value: undefined }),
      delete: () => Promise.resolve({ ok: true, value: undefined }),
    };
    const missingKey = await harness({ openai, secrets: missingKeyStore }).dispatcher.embed(['text'], {
      projectId,
      purpose: 'embedding',
    });
    expect(missingKey.ok).toBe(false);
    if (!missingKey.ok) expect(missingKey.error.code).toBe('SECRET_MISSING');

    const failedStore: ISecretStore = {
      get: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'INTERNAL', message: 'keychain unavailable', retryable: false },
        }),
      set: () => Promise.resolve({ ok: true, value: undefined }),
      delete: () => Promise.resolve({ ok: true, value: undefined }),
    };
    const storeFailure = await harness({ openai, secrets: failedStore }).dispatcher.embed(['text'], {
      projectId,
      purpose: 'embedding',
    });
    expect(storeFailure.ok).toBe(false);
    if (!storeFailure.ok) expect(storeFailure.error.message).toBe('keychain unavailable');
  });

  it('skips unavailable adapters and models, and leaves a zero vector unchanged', async () => {
    const unavailable = await harness({ openai: vi.fn<IEmbeddingProvider['embed']>(), providers: {} }).dispatcher.embed(
      ['text'],
      { projectId, purpose: 'embedding' },
    );
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) expect(unavailable.error.code).toBe('LADDER_EXHAUSTED');

    const nonEmbeddingModels: readonly ModelDescriptor[] = models.map((model) => ({ ...model, capabilities: [] }));
    const unsupported = await harness({
      openai: vi.fn<IEmbeddingProvider['embed']>(),
      models: nonEmbeddingModels,
    }).dispatcher.embed(['text'], { projectId, purpose: 'embedding' });
    expect(unsupported.ok).toBe(false);

    const zeroVector = harness({
      openai: () => Promise.resolve({ ok: true, value: { vectors: [[0, 0]], inputTokens: 1 } }),
      config: { fallbackModelKeys: [config.modelKey, ...config.fallbackModelKeys] },
    });
    await expect(zeroVector.dispatcher.embed(['text'], { projectId, purpose: 'embedding' })).resolves.toEqual({
      ok: true,
      value: [[0, 0]],
    });
  });

  it('retries thrown provider errors as transient failures', async () => {
    const openai = vi.fn<IEmbeddingProvider['embed']>(() => Promise.reject(new Error('internal')));
    const google = vi.fn<IEmbeddingProvider['embed']>((texts) =>
      Promise.resolve({ ok: true, value: { vectors: texts.map(() => [1, 0]), inputTokens: 1 } }),
    );
    const { dispatcher } = harness({ openai, google, useDefaultTiming: true });
    const result = await dispatcher.embed(['fallback'], { projectId, purpose: 'embedding' });
    expect(result).toMatchObject({ ok: true, value: [[1, 0]] });
    expect(openai).toHaveBeenCalledTimes(3);
    expect(google).toHaveBeenCalledOnce();
  });

  it('does not retry or fall back for ordinary bad requests', async () => {
    const openai = vi.fn<IEmbeddingProvider['embed']>(() =>
      Promise.resolve({
        ok: false,
        error: { kind: FailureKind.BAD_REQUEST, billed: false, message: 'invalid request' },
      }),
    );
    const google = vi.fn<IEmbeddingProvider['embed']>();
    const { dispatcher } = harness({ openai, google });
    const result = await dispatcher.embed(['text'], { projectId, purpose: 'embedding' });
    expect(result.ok).toBe(false);
    expect(openai).toHaveBeenCalledOnce();
    expect(google).not.toHaveBeenCalled();
  });
});
