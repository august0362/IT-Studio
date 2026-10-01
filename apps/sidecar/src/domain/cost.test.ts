import { describe, expect, it } from 'vitest';
import type { FxRate, PriceEntry, PriceTable, TokenUsage } from '@itstudio/schemas';
import { isoDateTimeSchema, priceTableVersionSchema } from '../validation/brand.js';
import {
  computeImageCost,
  computeTokenCost,
  estimateRequestCost,
  findPrice,
  microUsd,
  sumMicroUsd,
  toVnd,
  vnd,
} from './cost.js';

const sonnetPrice: PriceEntry = {
  modelKey: 'anthropic/claude-sonnet-5-5',
  inputPerMTokMicroUsd: microUsd(2_000_000),
  outputPerMTokMicroUsd: microUsd(10_000_000),
  cachedInputPerMTokMicroUsd: microUsd(200_000),
  freeTier: false,
  sourceUrl: 'https://claude.com/pricing',
};

const table: PriceTable = {
  version: priceTableVersionSchema.parse('test'),
  effectiveFrom: isoDateTimeSchema.parse('2026-10-01T00:00:00.000Z'),
  origin: 'seed',
  entries: [sonnetPrice],
};

const fx: FxRate = {
  usdToVnd: 25_000,
  asOf: isoDateTimeSchema.parse('2026-10-01T00:00:00.000Z'),
  source: 'auto',
};

describe('cost domain', () => {
  it('computes Sonnet cost from regular and cached tokens exactly', () => {
    const usage: TokenUsage = { inputTokens: 100_000, cachedInputTokens: 20_000, outputTokens: 10_000 };
    expect(computeTokenCost(usage, sonnetPrice)).toBe(264_000);
  });

  it('clamps cached tokens to input and rounds fractional micro-USD up', () => {
    expect(
      computeTokenCost(
        { inputTokens: 1, cachedInputTokens: 3, outputTokens: 0 },
        { ...sonnetPrice, cachedInputPerMTokMicroUsd: microUsd(1) },
      ),
    ).toBe(1);
    expect(
      computeTokenCost(
        { inputTokens: 1, cachedInputTokens: 0, outputTokens: 0 },
        { ...sonnetPrice, inputPerMTokMicroUsd: microUsd(1) },
      ),
    ).toBe(1);
  });

  it('keeps precision for billion-token usage', () => {
    expect(
      computeTokenCost({ inputTokens: 1_000_000_000, cachedInputTokens: 0, outputTokens: 1_000_000_000 }, sonnetPrice),
    ).toBe(12_000_000_000);
  });

  it('estimates prompt tokens by rounding characters up in groups of four', () => {
    expect(estimateRequestCost(5, 1, sonnetPrice)).toBe(14);
    expect(estimateRequestCost(0, 0, sonnetPrice)).toBe(0);
  });

  it('reports a missing image rate and computes configured image rates', () => {
    expect(computeImageCost(3, sonnetPrice)).toEqual({ cost: 0, missingPrice: true });
    expect(computeImageCost(3, { ...sonnetPrice, perImageMicroUsd: microUsd(125) })).toEqual({
      cost: 375,
      missingPrice: false,
    });
  });

  it('finds prices by model key', () => {
    expect(findPrice(table, 'anthropic/claude-sonnet-5-5')).toBe(sonnetPrice);
    expect(findPrice(table, 'anthropic/claude-opus-5-5')).toBeUndefined();
  });

  it('sums signed amounts exactly and validates constructors', () => {
    expect(sumMicroUsd([microUsd(10), microUsd(-15), microUsd(7)])).toBe(2);
    expect(() => sumMicroUsd([microUsd(Number.MAX_SAFE_INTEGER), microUsd(1)])).toThrow(RangeError);
    expect(() => microUsd(1.5)).toThrow(RangeError);
    expect(() => microUsd(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(vnd(-123)).toBe(-123);
    expect(() => vnd(Number.NaN)).toThrow(RangeError);
    expect(() =>
      computeTokenCost(
        { inputTokens: 1, cachedInputTokens: 0, outputTokens: 0 },
        {
          ...sonnetPrice,
          inputPerMTokMicroUsd: microUsd(-1),
        },
      ),
    ).toThrow(RangeError);
  });

  it('converts FX with half-up rounding for positive and negative amounts', () => {
    expect(toVnd(microUsd(1_000_000), fx)).toBe(25_000);
    expect(toVnd(microUsd(1), { ...fx, usdToVnd: 500_000 })).toBe(1);
    expect(toVnd(microUsd(-1), { ...fx, usdToVnd: 500_000 })).toBe(-1);
    expect(toVnd(microUsd(1), { ...fx, usdToVnd: 499_999 })).toBe(0);
    expect(toVnd(microUsd(1_000_000), { ...fx, usdToVnd: 2.5e-5 })).toBe(0);
    expect(() => toVnd(microUsd(1), { ...fx, usdToVnd: -1 })).toThrow(RangeError);
  });
});
