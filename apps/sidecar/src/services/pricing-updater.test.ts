import { describe, expect, it } from 'vitest';
import pino from 'pino';
import type { LlmRequest, LlmResponse, RpcNotificationMap } from '@itstudio/schemas';
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
  } = {},
) {
  const loaded = loadSeeds('config');
  if (!loaded.ok) throw new Error(loaded.error.message);
  const settings = {
    ...buildDefaultSettings(loaded.value),
    activeProjectId: options.active === false ? null : projectId,
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
    http,
    sources: options.sources ?? { [loaded.value.models[0]?.provider ?? 'openai']: ['https://example.invalid/pricing'] },
    models: loaded.value.models,
    events,
    ids: { uuid: () => '00000000-0000-4000-8000-000000000005' },
    clock: createFakeClock(new Date('2026-10-02T00:00:00.000Z')),
    logger: pino({ enabled: false }),
  });
  return { updater, pricing, requests, updates, loaded };
}

describe('PricingUpdater', () => {
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

  it('returns no_change without adding a version when extracted prices are unchanged', async () => {
    const base = harness();
    const model = base.loaded.value.models[0];
    const entry = base.loaded.value.pricing.entries.find((item) => item.modelKey === model?.key);
    if (entry === undefined || model === undefined) throw new Error('Test model is not priced');
    const h = harness({
      replies: [JSON.stringify({ entries: [entry] })],
      sources: { [model.provider]: ['https://example.invalid/pricing'] },
    });
    const version = h.pricing.current().version;
    const result = await h.updater.refresh();
    expect(result.ok && result.value.status).toBe('no_change');
    expect(h.pricing.current().version).toBe(version);
  });

  it('TC-M3-023 returns fetch_failed with an AppError when every source fails', async () => {
    const h = harness({ page: () => Promise.resolve(new Response('failed', { status: 500 })) });
    const result = await h.updater.refresh();
    expect(result.ok && result.value.status).toBe('fetch_failed');
    expect(result.ok && result.value.error?.remediation).toBeDefined();
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

  it('omits a provider after the second invalid JSON response', async () => {
    const base = harness();
    const model = base.loaded.value.models[0];
    if (model === undefined) throw new Error('Test model is missing');
    const h = harness({
      sources: { [model.provider]: ['https://example.invalid/pricing'] },
      replies: ['bad', 'still bad'],
    });
    const result = await h.updater.refresh();
    expect(result.ok && result.value.status).toBe('no_change');
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
});
