import { describe, expect, it } from 'vitest';
import type { ModelKey, PriceEntry, PriceTable } from '@itstudio/schemas';
import { microUsdSchema, isoDateTimeSchema } from '../validation/brand.js';
import { priceTableVersionSchema } from '../validation/common.js';
import { validatePriceEntries } from './price-validation.js';

const modelKey: ModelKey = 'openai/test-model';
const initial: PriceEntry = {
  modelKey,
  inputPerMTokMicroUsd: microUsdSchema.parse(100),
  outputPerMTokMicroUsd: microUsdSchema.parse(100),
  cachedInputPerMTokMicroUsd: microUsdSchema.parse(0),
  freeTier: false,
  sourceUrl: 'https://example.invalid/pricing',
};
const table: PriceTable = {
  version: priceTableVersionSchema.parse('seed'),
  effectiveFrom: isoDateTimeSchema.parse('2026-10-01T00:00:00.000Z'),
  origin: 'seed',
  entries: [initial],
};
const known = new Set<ModelKey>([modelKey]);

function changedInput(value: number): PriceEntry {
  return { ...initial, inputPerMTokMicroUsd: microUsdSchema.parse(value) };
}

function changedCached(value: number): PriceEntry {
  return { ...initial, cachedInputPerMTokMicroUsd: microUsdSchema.parse(value) };
}

function withInvalidRate(value: number): PriceEntry {
  return {
    ...initial,
    // @ts-expect-error Test an unvalidated external rate at the pure validation boundary.
    inputPerMTokMicroUsd: value,
  };
}

describe('validatePriceEntries', () => {
  it('accepts exactly the percent limit and rejects a change 0.01 above it', () => {
    const baseline: PriceTable = {
      ...table,
      entries: [{ ...initial, inputPerMTokMicroUsd: microUsdSchema.parse(10_000) }],
    };
    const accepted = validatePriceEntries('openai', [changedInput(15_000)], baseline, known, 50);
    const rejected = validatePriceEntries('openai', [changedInput(15_001)], baseline, known, 50);
    expect(accepted.valid).toBe(true);
    expect(accepted.deltas[0]?.percent).toBe(50);
    expect(rejected.valid).toBe(false);
  });

  it('handles zero baselines and detects all nonzero changes as 100 percent', () => {
    const unchanged = validatePriceEntries('openai', [initial], table, known, 100);
    const zeroToPositive = validatePriceEntries('openai', [changedCached(1)], table, known, 100);
    expect(unchanged.deltas).toEqual([]);
    expect(zeroToPositive.deltas[0]?.percent).toBe(100);
    expect(zeroToPositive.valid).toBe(true);
  });

  it.each([
    ['negative', -1],
    ['non-integer', 1.5],
    ['above cap', 1_000_000_001],
  ])('rejects a %s rate', (_name, rate) => {
    const entry = withInvalidRate(rate);
    expect(validatePriceEntries('openai', [entry], table, known, 100).valid).toBe(false);
  });

  it('drops and reports unknown models, other providers, duplicates, and manual overrides', () => {
    const unknown: PriceEntry = { ...initial, modelKey: 'openai/not-registered' };
    const otherProvider: PriceEntry = { ...initial, modelKey: 'google/test-model' };
    const registered = new Set<ModelKey>([modelKey, otherProvider.modelKey]);
    const result = validatePriceEntries(
      'openai',
      [unknown, otherProvider, initial, initial],
      table,
      registered,
      100,
      new Set([modelKey]),
    );
    expect(result.unknownModels).toEqual(['openai/not-registered']);
    expect(result.entries).toEqual([]);
    expect(result.valid).toBe(false);
  });

  it('accepts a new model using the zero baseline and reports a difference in metadata', () => {
    const newKey: ModelKey = 'openai/new-model';
    const newEntry: PriceEntry = {
      ...initial,
      modelKey: newKey,
      inputPerMTokMicroUsd: microUsdSchema.parse(0),
      outputPerMTokMicroUsd: microUsdSchema.parse(0),
      cachedInputPerMTokMicroUsd: microUsdSchema.parse(0),
      sourceUrl: 'https://example.invalid/new',
    };
    const result = validatePriceEntries('openai', [newEntry], { ...table, entries: [] }, new Set([newKey]), 100);
    expect(result.valid).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.deltas).toEqual([]);
  });

  it('includes image rate deltas and recognizes metadata-only changes', () => {
    const withImage: PriceEntry = {
      ...initial,
      perImageMicroUsd: microUsdSchema.parse(100),
    };
    const withMoreImageCost: PriceEntry = {
      ...withImage,
      perImageMicroUsd: microUsdSchema.parse(150),
    };
    const imageResult = validatePriceEntries(
      'openai',
      [withMoreImageCost],
      { ...table, entries: [withImage] },
      known,
      50,
    );
    expect(imageResult.deltas).toEqual([{ modelKey, field: 'perImageMicroUsd', percent: 50 }]);
    const metadataResult = validatePriceEntries('openai', [{ ...initial, freeTier: true }], table, known, 0);
    expect(metadataResult.changed).toBe(true);
    expect(metadataResult.deltas).toEqual([]);
  });
});
