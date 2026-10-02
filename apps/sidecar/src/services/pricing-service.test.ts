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
  it('TC-M3-012 reports price rows with formatted values and the exact 30-day stale boundary', () => {
    const testHarness = harness();
    testHarness.service.initialize();
    const fx = { usdToVnd: 25_000, asOf: isoDateTimeSchema.parse('2026-10-01T00:00:00.000Z'), source: 'auto' as const };
    expect(testHarness.service.getRows(fx).stale).toBe(false);
    expect(testHarness.service.getRows(fx).rows[0]?.input.usdText).toBe('$0.0001');
    testHarness.clock.advance(30 * 24 * 60 * 60 * 1000 - 1);
    expect(testHarness.service.getRows(fx).stale).toBe(false);
    testHarness.clock.advance(1);
    expect(testHarness.service.getRows(fx).stale).toBe(true);
    expect(testHarness.service.getRows(fx).rows[0]?.overridden).toBe(false);
  });

  it('validates decimal USD overrides and marks the selected price row overridden', () => {
    const { service } = harness();
    service.initialize();
    expect(
      service.overrideUsd({
        modelKey: 'openai/test-model',
        inputPerMTokUsd: '0.25',
        outputPerMTokUsd: '0.5',
        cachedInputPerMTokUsd: '0.125',
      }).ok,
    ).toBe(true);
    const fx = { usdToVnd: 25_000, asOf: isoDateTimeSchema.parse('2026-10-01T00:00:00.000Z'), source: 'auto' as const };
    const row = service.getRows(fx).rows.find((entry) => entry.entry.modelKey === 'openai/test-model');
    expect(row?.overridden).toBe(true);
    expect(row?.entry.inputPerMTokMicroUsd).toBe(250_000);
    expect(
      service.overrideUsd({
        modelKey: 'openai/test-model',
        inputPerMTokUsd: '0.0000001',
        outputPerMTokUsd: '1',
        cachedInputPerMTokUsd: '1',
      }).ok,
    ).toBe(false);
    expect(
      service.overrideUsd({
        modelKey: 'openai/unknown',
        inputPerMTokUsd: '1',
        outputPerMTokUsd: '1',
        cachedInputPerMTokUsd: '1',
      }).ok,
    ).toBe(false);
  });

  it('TC-M3-011 accepts a zero price and rejects malformed USD override decimals', () => {
    const { service } = harness();
    service.initialize();
    const override = (value: string) =>
      service.overrideUsd({
        modelKey: 'openai/test-model',
        inputPerMTokUsd: value,
        outputPerMTokUsd: '1',
        cachedInputPerMTokUsd: '1',
      });
    expect(override('0').ok).toBe(true);
    expect(
      service.current().entries.find((entry) => entry.modelKey === 'openai/test-model')?.inputPerMTokMicroUsd,
    ).toBe(0);
    for (const value of ['1000.000001', '1e3', '-1']) expect(override(value).ok).toBe(false);
  });

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
