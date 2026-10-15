import { describe, expect, it } from 'vitest';
import pino from 'pino';
import type {
  AppError,
  LlmRequest,
  LlmResponse,
  ModelDescriptor,
  ModelKey,
  ProviderId,
  RpcNotificationMap,
} from '@itstudio/schemas';
import { loadSeeds } from '../config/load-seeds.js';
import { buildDefaultSettings } from '../domain/default-settings.js';
import { createFakeClock } from '../infra/clock.js';
import { EventBus } from '../rpc/event-bus.js';
import type { IPriceRepository, StoredPriceTable } from '../ports/price-repository.js';
import type { IProjectRepository } from '../ports/project-repository.js';
import {
  conversationIdSchema,
  isoDateTimeSchema,
  messageIdSchema,
  microUsdSchema,
  projectIdSchema,
} from '../validation/brand.js';
import { PricingService } from './pricing-service.js';
import { PricingUpdater } from './pricing-updater.js';

const projectId = projectIdSchema.parse('00000000-0000-4000-8000-000000000001');
const project = {
  id: projectId,
  name: 'Updater test',
  workspaceRoot: 'C:\\test',
  createdAt: isoDateTimeSchema.parse('2026-10-01T00:00:00.000Z'),
  archived: false,
};

function harness(
  options: {
    readonly active?: boolean;
    readonly page?: (url: string) => Promise<Response>;
    readonly replies?: readonly string[];
    readonly sources?: Readonly<Record<string, readonly string[]>>;
    readonly keyedProviders?: readonly ProviderId[];
    readonly models?: readonly ModelDescriptor[];
    readonly extractionModel?: ModelKey;
    readonly dispatchError?: AppError;
  } = {},
) {
  const loaded = loadSeeds('config');
  if (!loaded.ok) throw new Error(loaded.error.message);
  const settings = {
    ...buildDefaultSettings(loaded.value),
    activeProjectId: options.active === false ? null : projectId,
    pricing: {
      ...buildDefaultSettings(loaded.value).pricing,
      extractionModelKey: options.extractionModel ?? loaded.value.defaultPricingExtractionModel,
    },
  };
  let current: StoredPriceTable | null = { ...loaded.value.pricing, manualOverrides: [] };
  const repository: IPriceRepository = {
    current: () => current,
    insert: (table) => {
      current = table;
    },
  };
  const pricing = new PricingService({
    repository,
    seed: loaded.value.pricing,
    knownModels: new Set(loaded.value.models.map((model) => model.key)),
    ids: { uuid: () => '00000000-0000-4000-8000-000000000002' },
    clock: createFakeClock(new Date('2026-10-02T00:00:00.000Z')),
  });
  const projects: IProjectRepository = {
    list: () => Promise.resolve([project]),
    get: (id) => Promise.resolve(id === projectId && options.active !== false ? project : null),
    getByWorkspaceRoot: () => Promise.resolve(null),
    create: () => Promise.resolve(),
    setArchived: () => Promise.resolve(true),
  };
  const http = {
    request: (input: string | URL) =>
      options.page?.(String(input)) ??
      Promise.resolve(
        new Response('<html><body>Price page</body></html>', { headers: { 'content-type': 'text/html' } }),
      ),
  };
  const requests: LlmRequest[] = [];
  const replyQueue = [...(options.replies ?? [])];
  const router = {
    dispatch: (request: LlmRequest) => {
      requests.push(request);
      if (options.dispatchError !== undefined)
        return Promise.resolve({ ok: false as const, error: options.dispatchError });
      const text = replyQueue.shift() ?? '{"entries":[]}';
      const message = {
        id: messageIdSchema.parse('00000000-0000-4000-8000-000000000003'),
        conversationId: conversationIdSchema.parse('00000000-0000-4000-8000-000000000004'),
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text }],
        createdAt: isoDateTimeSchema.parse('2026-10-02T00:00:01.000Z'),
      };
      const response: LlmResponse = {
        requestId: request.id,
        modelKey: request.ladderOverride?.[0] ?? loaded.value.defaultPricingExtractionModel,
        message,
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
        costMicroUsd: microUsdSchema.parse(0),
        finishReason: 'stop',
        attempts: [],
        latencyMs: 1,
      };
      return Promise.resolve({ ok: true as const, value: response });
    },
  };
  const updates: unknown[] = [];
  const events = new EventBus<RpcNotificationMap>();
  events.subscribe('pricing.updated', (payload) => updates.push(payload));
  const updater = new PricingUpdater({
    settings: { get: () => Promise.resolve({ ok: true as const, value: settings }) },
    projects,
    pricing,
    router,
    secretStore: {
      get: (provider) =>
        Promise.resolve({
          ok: true as const,
          value: (options.keyedProviders ?? loaded.value.models.map((model) => model.provider)).includes(provider)
            ? 'test-only-key'
            : null,
        }),
    },
    http,
    sources: options.sources ?? { [loaded.value.models[0]?.provider ?? 'openai']: ['https://example.invalid/pricing'] },
    models: options.models ?? loaded.value.models,
    events,
    ids: { uuid: () => '00000000-0000-4000-8000-000000000005' },
    clock: createFakeClock(new Date('2026-10-02T00:00:00.000Z')),
    logger: pino({ enabled: false }),
  });
  return { updater, pricing, requests, updates, loaded };
}

describe('PricingUpdater', () => {
  it('PROV-01 refreshes nested OpenRouter model prices with the full model key', async () => {
    const seeds = harness();
    const entry = seeds.loaded.value.pricing.entries.find(
      (item) => item.modelKey === 'openrouter/deepseek/deepseek-v4-flash',
    );
    if (entry === undefined) throw new Error('Missing OpenRouter seed price');
    const h = harness({
      sources: { openrouter: ['https://example.invalid/openrouter'] },
      replies: [JSON.stringify({ entries: [entry] })],
    });
    const result = await h.updater.refresh();
    expect(result).toMatchObject({ ok: true, value: { status: 'no_change' } });
    expect(h.pricing.current().entries.find((item) => item.modelKey === entry.modelKey)).toMatchObject({
      ...entry,
      origin: 'auto_extracted',
    });
    expect(JSON.stringify(h.requests)).toContain('openrouter/deepseek/deepseek-v4-flash');
  });
  it('TC-M3-022 fails with VALIDATION before fetching when no active project exists', async () => {
    let fetches = 0;
    const h = harness({
      active: false,
      page: () => {
        fetches += 1;
        return Promise.resolve(new Response('page'));
      },
    });
    const result = await h.updater.refresh();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.remediation).toEqual(['Open or create a project first.']);
    expect(fetches).toBe(0);
    expect(h.requests).toHaveLength(0);
  });

  it('applies a valid update through a metered pricing_extraction request', async () => {
    const seed = harness();
    const provider = seed.loaded.value.models[0]?.provider ?? 'openai';
    const entry = seed.loaded.value.pricing.entries.find((item) => item.modelKey === seed.loaded.value.models[0]?.key);
    if (entry === undefined) throw new Error('Test model is not priced');
    const updated = {
      ...entry,
      inputPerMTokMicroUsd: entry.inputPerMTokMicroUsd + Math.max(1, Math.round(entry.inputPerMTokMicroUsd * 0.1)),
    };
    const h = harness({
      replies: [JSON.stringify({ entries: [updated] })],
      sources: { [provider]: ['https://example.invalid/pricing'] },
    });
    const result = await h.updater.refresh();
    expect(result.ok && result.value.status).toBe('applied');
    expect(h.requests[0]?.purpose).toBe('pricing_extraction');
    expect(h.requests[0]?.projectId).toBe(projectId);
    expect(h.pricing.current().origin).toBe('auto_extracted');
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]).toEqual(result.ok ? result.value : undefined);
  });

  it('verifies unchanged seed prices then avoids a new version once provenance is already automatic', async () => {
    const base = harness();
    const model = base.loaded.value.models[0];
    const entry = base.loaded.value.pricing.entries.find((item) => item.modelKey === model?.key);
    if (entry === undefined || model === undefined) throw new Error('Test model is not priced');
    const h = harness({
      replies: [JSON.stringify({ entries: [entry] }), JSON.stringify({ entries: [entry] })],
      sources: { [model.provider]: ['https://example.invalid/pricing'] },
    });
    const version = h.pricing.current().version;
    const result = await h.updater.refresh();
    expect(result.ok && result.value.status).toBe('no_change');
    expect(h.pricing.current().version).not.toBe(version);
    expect(h.pricing.current().entries.find((item) => item.modelKey === entry.modelKey)?.origin).toBe('auto_extracted');
    const verifiedVersion = h.pricing.current().version;
    const repeated = await h.updater.refresh();
    expect(repeated.ok && repeated.value.status).toBe('no_change');
    expect(h.pricing.current().version).toBe(verifiedVersion);
  });

  it('TC-M3-023 returns fetch_failed with an AppError when every source fails', async () => {
    const h = harness({ page: () => Promise.resolve(new Response('failed', { status: 500 })) });
    const result = await h.updater.refresh();
    expect(result.ok && result.value.status).toBe('fetch_failed');
    expect(result.ok && result.value.error?.remediation).toBeDefined();
    expect(result.ok && result.value.providerOutcomes?.[0]?.reason).toContain('HTTP 500');
    expect(h.requests).toHaveLength(0);
  });

  it('continues after a partial page fetch failure', async () => {
    const base = harness();
    const model = base.loaded.value.models[0];
    const entry = base.loaded.value.pricing.entries.find((item) => item.modelKey === model?.key);
    if (entry === undefined || model === undefined) throw new Error('Test model is not priced');
    const h = harness({
      sources: { [model.provider]: ['https://example.invalid/bad', 'https://example.invalid/good'] },
      page: (url) =>
        Promise.resolve(
          url.endsWith('/bad')
            ? new Response('unavailable', { status: 503 })
            : new Response('price page', { headers: { 'content-type': 'text/plain' } }),
        ),
      replies: [JSON.stringify({ entries: [entry] })],
    });
    const result = await h.updater.refresh();
    expect(result.ok && result.value.status).toBe('no_change');
    expect(h.requests).toHaveLength(1);
    expect(result.ok && result.value.providerOutcomes?.[0]?.reason).toContain('1 source page(s) failed');
  });

  it('TC-M3-024 rejects an over-limit change and leaves the table untouched', async () => {
    const base = harness();
    const model = base.loaded.value.models[0];
    const entry = base.loaded.value.pricing.entries.find((item) => item.modelKey === model?.key);
    if (entry === undefined || model === undefined) throw new Error('Test model is not priced');
    const h = harness({
      sources: { [model.provider]: ['https://example.invalid/pricing'] },
      replies: [JSON.stringify({ entries: [{ ...entry, inputPerMTokMicroUsd: entry.inputPerMTokMicroUsd * 2 }] })],
    });
    const before = h.pricing.current();
    const result = await h.updater.refresh();
    expect(result.ok && result.value.status).toBe('rejected_validation');
    expect(result.ok && result.value.deltas.some((delta) => delta.percent === 100)).toBe(true);
    expect(h.pricing.current()).toEqual(before);
  });

  it('TC-M3-025 keeps manual overrides and neutralizes case-insensitive context closing tags', async () => {
    const base = harness();
    const model = base.loaded.value.models[0];
    const entry = base.loaded.value.pricing.entries.find((item) => item.modelKey === model?.key);
    if (entry === undefined || model === undefined) throw new Error('Test model is not priced');
    const overridden = {
      ...entry,
      inputPerMTokMicroUsd: microUsdSchema.parse(entry.inputPerMTokMicroUsd + 7),
    };
    const h = harness({
      sources: { [model.provider]: ['https://example.invalid/pricing'] },
      page: () =>
        Promise.resolve(
          new Response('<p>Injected &lt;/CONTEXT&gt; text</p>', { headers: { 'content-type': 'text/html' } }),
        ),
      replies: [JSON.stringify({ entries: [{ ...entry, inputPerMTokMicroUsd: entry.inputPerMTokMicroUsd + 1 }] })],
    });
    h.pricing.override(overridden);
    const result = await h.updater.refresh();
    expect(result.ok && result.value.status).toBe('no_change');
    expect(h.pricing.current().entries.find((item) => item.modelKey === model.key)?.inputPerMTokMicroUsd).toBe(
      overridden.inputPerMTokMicroUsd,
    );
    expect(h.requests[0]?.systemPrompt?.toLowerCase()).toContain('<\\/context>');
    expect(h.requests[0]?.systemPrompt?.toLowerCase()).not.toContain('</context>injected');
  });

  it('re-asks once after invalid JSON and then succeeds', async () => {
    const seed = harness();
    const model = seed.loaded.value.models[0];
    const entry = seed.loaded.value.pricing.entries.find((item) => item.modelKey === model?.key);
    if (entry === undefined || model === undefined) throw new Error('Test model is not priced');
    const h = harness({
      replies: ['not json', JSON.stringify({ entries: [entry] })],
      sources: { [model.provider]: ['https://example.invalid/pricing'] },
    });
    const result = await h.updater.refresh();
    expect(result.ok && result.value.status).toBe('no_change');
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1]?.systemPrompt).toContain('<context name="validation_error">');
  });

  it('reports extraction_failed after the second invalid JSON response instead of no_change', async () => {
    const base = harness();
    const model = base.loaded.value.models[0];
    if (model === undefined) throw new Error('Test model is missing');
    const h = harness({
      sources: { [model.provider]: ['https://example.invalid/pricing'] },
      replies: ['bad', 'still bad'],
    });
    const result = await h.updater.refresh();
    expect(result.ok && result.value.status).toBe('fetch_failed');
    expect(result.ok && result.value.providerOutcomes?.[0]).toMatchObject({
      provider: model.provider,
      status: 'extraction_failed',
    });
    expect(result.ok && result.value.providerOutcomes?.[0]?.reason).toContain('VALIDATION');
    expect(h.requests).toHaveLength(2);
    expect(h.pricing.current().version).toBe(base.pricing.current().version);
  });

  it('shares the same in-flight promise across concurrent refresh calls', async () => {
    let release: ((response: Response) => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const h = harness({
      page: () =>
        new Promise<Response>((resolve) => {
          release = resolve;
          markStarted?.();
        }),
    });
    const first = h.updater.refresh();
    const second = h.updater.refresh();
    expect(second).toBe(first);
    await started;
    release?.(new Response('<p>Price</p>', { headers: { 'content-type': 'text/html' } }));
    await first;
  });

  it('selects the cheapest keyed chat/json model using the current input price when the configured key is absent', async () => {
    const base = harness();
    const models = base.loaded.value.models.filter(
      (model) => model.provider === 'google' && model.capabilities.includes('chat'),
    );
    const lowest = models[0];
    const other = models[1];
    if (lowest === undefined || other === undefined) throw new Error('Google chat fixtures are missing');
    const h = harness({ keyedProviders: ['google'] });
    const entry = h.pricing.current().entries.find((item) => item.modelKey === other.key);
    if (entry === undefined) throw new Error('Google pricing fixture is missing');
    h.pricing.override({ ...entry, inputPerMTokMicroUsd: microUsdSchema.parse(1) });
    await h.updater.refresh();
    expect(h.requests[0]?.ladderOverride).toEqual([other.key]);
    expect(h.requests[0]?.requiredCapabilities).toEqual(['chat', 'json_mode']);
  });

  it('keeps a usable configured model even when another keyed model is cheaper', async () => {
    const h = harness();
    await h.updater.refresh();
    expect(h.requests[0]?.ladderOverride).toEqual([h.loaded.value.defaultPricingExtractionModel]);
  });

  it.each(['disabled', 'no_chat', 'no_json'] as const)(
    'falls back when the configured model is unusable: %s',
    async (kind) => {
      const base = harness();
      const configured = base.loaded.value.models.find(
        (model) => model.key === base.loaded.value.defaultPricingExtractionModel,
      );
      if (configured === undefined) throw new Error('Configured model fixture is missing');
      const models = base.loaded.value.models.map((model) =>
        model.key !== configured.key
          ? model
          : {
              ...model,
              enabled: kind !== 'disabled',
              capabilities: model.capabilities.filter((capability) =>
                kind === 'no_chat' ? capability !== 'chat' : kind === 'no_json' ? capability !== 'json_mode' : true,
              ),
            },
      );
      const h = harness({ models, keyedProviders: ['openai'] });
      await h.updater.refresh();
      expect(h.requests[0]?.ladderOverride?.[0]).not.toBe(configured.key);
      const selected = models.find((model) => model.key === h.requests[0]?.ladderOverride?.[0]);
      expect(selected?.capabilities).toEqual(expect.arrayContaining(['chat', 'json_mode']));
    },
  );

  it('returns the exact missing-key validation before any source request or extraction', async () => {
    let fetches = 0;
    const h = harness({
      keyedProviders: [],
      page: () => {
        fetches += 1;
        return Promise.resolve(new Response('page'));
      },
    });
    const result = await h.updater.refresh();
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        code: 'VALIDATION',
        message: 'Add an API key first — price extraction needs one AI call (cost shown before running).',
      });
    expect(fetches).toBe(0);
    expect(h.requests).toHaveLength(0);
  });

  it('reports applied and fetch_failed outcomes together without hiding a provider failure', async () => {
    const base = harness();
    const entry = base.loaded.value.pricing.entries.find((item) => item.modelKey.startsWith('openai/'));
    if (entry === undefined) throw new Error('OpenAI pricing fixture is missing');
    const h = harness({
      sources: { google: ['https://example.invalid/bad'], openai: ['https://example.invalid/good'] },
      page: (url) => Promise.resolve(new Response('page', { status: url.endsWith('/bad') ? 503 : 200 })),
      replies: [JSON.stringify({ entries: [{ ...entry, inputPerMTokMicroUsd: entry.inputPerMTokMicroUsd + 1 }] })],
    });
    const result = await h.updater.refresh();
    expect(result.ok && result.value.status).toBe('applied');
    expect(result.ok && result.value.providerOutcomes?.map(({ provider, status }) => ({ provider, status }))).toEqual(
      expect.arrayContaining([
        { provider: 'google', status: 'fetch_failed' },
        { provider: 'openai', status: 'applied' },
      ]),
    );
    expect(result.ok && result.value.providerOutcomes?.every((item) => item.reason.length > 0)).toBe(true);
  });

  it('returns rejected_validation provider outcomes without applying any model when one provider rejects', async () => {
    const base = harness();
    const openai = base.loaded.value.pricing.entries.find((item) => item.modelKey.startsWith('openai/'));
    const google = base.loaded.value.pricing.entries.find((item) => item.modelKey.startsWith('google/'));
    if (openai === undefined || google === undefined) throw new Error('Pricing fixtures are missing');
    const h = harness({
      sources: { openai: ['https://example.invalid/openai'], google: ['https://example.invalid/google'] },
      replies: [
        JSON.stringify({ entries: [{ ...openai, inputPerMTokMicroUsd: openai.inputPerMTokMicroUsd + 1 }] }),
        JSON.stringify({ entries: [{ ...google, inputPerMTokMicroUsd: google.inputPerMTokMicroUsd * 3 }] }),
      ],
    });
    const before = h.pricing.current();
    const result = await h.updater.refresh();
    expect(result.ok && result.value.status).toBe('rejected_validation');
    expect(result.ok && result.value.providerOutcomes?.map((item) => item.status)).toEqual([
      'rejected_validation',
      'rejected_validation',
    ]);
    expect(h.pricing.current()).toEqual(before);
  });

  it('shows extraction_failed with a safe code and never exposes raw provider error text', async () => {
    const h = harness({
      dispatchError: { code: 'PROVIDER_AUTH', message: 'Sensitive provider response', retryable: false },
    });
    const result = await h.updater.refresh();
    expect(result.ok && result.value.status).toBe('fetch_failed');
    expect(result.ok && result.value.providerOutcomes?.[0]?.status).toBe('extraction_failed');
    expect(JSON.stringify(result)).not.toContain('Sensitive provider response');
  });

  it('shows keyed extraction options and a retry-aware estimate without network or paid calls', async () => {
    let fetches = 0;
    const h = harness({
      keyedProviders: ['google'],
      sources: {
        google: ['https://example.invalid/one', 'https://example.invalid/two'],
        openai: ['https://example.invalid/three'],
      },
      page: () => {
        fetches += 1;
        return Promise.resolve(new Response('page'));
      },
    });
    const flash = h.loaded.value.models.find(
      (model) => model.provider === 'google' && model.capabilities.includes('chat'),
    );
    const entry = h.pricing.current().entries.find((item) => item.modelKey === flash?.key);
    if (entry === undefined || flash === undefined) throw new Error('Google fixture is missing');
    h.pricing.override({
      ...entry,
      inputPerMTokMicroUsd: microUsdSchema.parse(1_000_000),
      outputPerMTokMicroUsd: microUsdSchema.parse(1_000_000),
    });
    const result = await h.updater.extractionOptions({ usdToVnd: 25_000, asOf: project.createdAt, source: 'auto' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selectedModelKey).toBe(flash.key);
    expect(
      result.value.options.every(
        (option) => option.modelKey.startsWith('google/') && !option.modelKey.includes('embedding'),
      ),
    ).toBe(true);
    const estimate = result.value.options.find((option) => option.modelKey === flash.key)?.estimatedCost.microUsd;
    // $1 per MTok is one micro-dollar per planned token: include the full byte budget and both retries.
    expect(estimate).toBeGreaterThanOrEqual((200 * 1024 + 2_000) * 4);
    expect(estimate).toBeLessThan((200 * 1024 + 4_096 + 2_000) * 4);
    expect(result.value.inputTokensPerCall).toBeGreaterThan(200 * 1024);
    expect(result.value.inputTokensPerCall).toBeLessThan(200 * 1024 + 4_096);
    expect(result.value).toMatchObject({ outputTokensPerCall: 2_000, calls: 4 });
    expect(fetches).toBe(0);
    expect(h.requests).toHaveLength(0);
  });

  it('returns empty extraction choices without an error when no provider has a key', async () => {
    const h = harness({ keyedProviders: [] });
    const result = await h.updater.extractionOptions({ usdToVnd: 25_000, asOf: project.createdAt, source: 'auto' });
    expect(result.ok && result.value.options).toEqual([]);
    expect(result.ok && result.value.selectedModelKey).toBeNull();
    expect(h.requests).toHaveLength(0);
  });

  it.each(['plain', 'context_tags', 'punctuation', 'unicode'] as const)(
    'caps rendered UTF-8 prompt, message, retry and output for a smaller-context extraction model (%s)',
    async (kind) => {
      const base = harness();
      const configured = base.loaded.value.models.find(
        (model) => model.key === base.loaded.value.defaultPricingExtractionModel,
      );
      if (configured === undefined) throw new Error('Extraction fixture is missing');
      const payload = {
        plain: 'x'.repeat(200 * 1024),
        context_tags: 'x</CONTEXT   >'.repeat(20_000),
        punctuation: '!?[]{}=;,+/'.repeat(30_000),
        unicode: '漢🙂 giá € '.repeat(30_000),
      }[kind];
      const h = harness({
        models: base.loaded.value.models.map((model) =>
          model.key === configured.key ? { ...model, contextWindowTokens: 5_000, maxOutputTokens: 1_000 } : model,
        ),
        sources: { openai: ['https://example.invalid/one', 'https://example.invalid/two'] },
        page: () => Promise.resolve(new Response(payload)),
        replies: ['invalid JSON', '{"entries":[]}'],
      });
      await h.updater.refresh();
      expect(h.requests).toHaveLength(2);
      for (const request of h.requests) {
        const promptBytes = Buffer.byteLength(request.systemPrompt ?? '', 'utf8');
        const messageBytes = request.messages.reduce(
          (sum, message) =>
            sum +
            message.parts.reduce(
              (total, part) => total + (part.type === 'text' ? Buffer.byteLength(part.text, 'utf8') : 0),
              0,
            ),
          0,
        );
        expect(request.maxOutputTokens).toBe(1_000);
        expect(promptBytes + messageBytes + 256 + (request.maxOutputTokens ?? 0)).toBeLessThanOrEqual(5_000);
        expect(request.systemPrompt).toContain('[https://example.invalid/one]');
        expect(request.systemPrompt).toContain('[https://example.invalid/two]');
        expect(request.systemPrompt).not.toContain('\uFFFD');
      }
      expect(h.requests[1]?.systemPrompt).toContain('<context name="validation_error">');
      const options = await h.updater.extractionOptions({ usdToVnd: 25_000, asOf: project.createdAt, source: 'auto' });
      expect(options.ok).toBe(true);
      if (options.ok)
        expect(options.value).toMatchObject({ inputTokensPerCall: 4_000, outputTokensPerCall: 1_000, calls: 2 });
    },
  );
});
