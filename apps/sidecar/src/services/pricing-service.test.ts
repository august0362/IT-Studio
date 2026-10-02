import { describe, expect, it } from 'vitest';
import type { ModelKey, PriceEntry, PriceTable } from '@itstudio/schemas';
import { createFakeClock } from '../infra/clock.js';
import type { IPriceRepository, StoredPriceTable } from '../ports/price-repository.js';
import { isoDateTimeSchema, microUsdSchema } from '../validation/brand.js';
import { modelKeySchema, priceTableVersionSchema } from '../validation/common.js';
import { PricingService } from './pricing-service.js';

const initial: PriceTable = {
  version: priceTableVersionSchema.parse('seed-test'),
  effectiveFrom: isoDateTimeSchema.parse('2026-10-01T00:00:00.000Z'),
  origin: 'seed',
  entries: [
    {
      modelKey: 'openai/test-model',
      inputPerMTokMicroUsd: microUsdSchema.parse(100),
      outputPerMTokMicroUsd: microUsdSchema.parse(200),
      cachedInputPerMTokMicroUsd: microUsdSchema.parse(50),
      freeTier: false,
      sourceUrl: 'https://example.invalid/pricing',
    },
    {
      modelKey: 'google/test-model',
      inputPerMTokMicroUsd: microUsdSchema.parse(300),
      outputPerMTokMicroUsd: microUsdSchema.parse(400),
      cachedInputPerMTokMicroUsd: microUsdSchema.parse(75),
      freeTier: false,
      sourceUrl: 'https://example.invalid/pricing',
    },
  ],
};

function harness() {
  let current: StoredPriceTable | null = null;
  let inserts = 0;
  const repository: IPriceRepository = {
    current: () => current,
    insert: (table) => {
      current = table;
      inserts += 1;
    },
  };
  const clock = createFakeClock(new Date('2026-10-01T00:00:00.000Z'));
  let nextId = 1;
  const service = new PricingService({
    repository,
    seed: initial,
    knownModels: new Set<ModelKey>(['openai/test-model', 'google/test-model']),
    ids: { uuid: () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}` },
    clock,
  });
  return {
    service,
    clock,
    get current() {
      return current;
    },
    get inserts() {
      return inserts;
    },
  };
}

function openAiEntry(): PriceEntry {
  const entry = initial.entries.find((item) => item.modelKey === 'openai/test-model');
  if (entry === undefined) throw new Error('Test seed is missing the OpenAI entry');
  return entry;
}

describe('PricingService', () => {
  it('imports the seed once and creates a version with just the selected model changed', () => {
    const testHarness = harness();
    const { service } = testHarness;
    service.initialize();
    service.initialize();
    expect(testHarness.inserts).toBe(1);
    const changed: PriceEntry = {
      ...openAiEntry(),
      inputPerMTokMicroUsd: microUsdSchema.parse(999),
    };
    const result = service.override(changed);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).not.toBe(initial.version);
    expect(result.value.entries).toEqual([
      changed,
      initial.entries.find((entry) => entry.modelKey === 'google/test-model'),
    ]);
    expect(testHarness.current?.manualOverrides).toEqual(['openai/test-model']);
    expect(testHarness.current?.origin).toBe('manual_override');
  });

  it('rejects invalid values and model keys', () => {
    const { service } = harness();
    service.initialize();
    const invalid = service.override({
      ...openAiEntry(),
      // @ts-expect-error Deliberately pass an invalid rate to exercise runtime validation.
      inputPerMTokMicroUsd: -1,
    });
    expect(invalid.ok).toBe(false);
    const unknown = service.override({ ...openAiEntry(), modelKey: modelKeySchema.parse('openai/unknown') });
    expect(unknown.ok).toBe(false);
  });

  it('tracks manual precedence until the internal clear operation', () => {
    const testHarness = harness();
    const { service } = testHarness;
    service.initialize();
    const result = service.override({ ...openAiEntry(), inputPerMTokMicroUsd: microUsdSchema.parse(999) });
    expect(result.ok).toBe(true);
    const cleared = service.clearOverride('openai/test-model');
    expect(cleared.ok).toBe(true);
    expect(testHarness.current?.manualOverrides).toEqual([]);
    expect(testHarness.current?.entries[0]?.inputPerMTokMicroUsd).toBe(999);
  });

  it.each([
    ['29 days 23 hours', 29 * 24 + 23, false],
    ['30 days', 30 * 24, true],
    ['30 days 1 hour', 30 * 24 + 1, true],
  ])('evaluates staleness at %s', (_label, hours, expected) => {
    const { service, clock } = harness();
    service.initialize();
    clock.advance(hours * 60 * 60 * 1000);
    expect(service.isStale()).toBe(expected);
  });
});
