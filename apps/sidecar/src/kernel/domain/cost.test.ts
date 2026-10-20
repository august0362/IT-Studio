import { describe, expect, it, vi } from 'vitest';
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
  // ARCH §6.1: cost = ceil(Σ tokens × price / 1e6) — conservative billing; any non-zero usage costs ≥ 1 µUSD.
  it.each([
    [0, 0],
    [1, 1],
    [999_999, 1],
    [1_000_000, 1],
    [1_000_001, 2],
    [1_500_000, 2],
  ])('TC-M3-002 rounds %i tokens at 1 micro-USD per million up (ceil) to %i', (tokens, expected) => {
    const price = { ...sonnetPrice, inputPerMTokMicroUsd: microUsd(1) };
    expect(computeTokenCost({ inputTokens: tokens, cachedInputTokens: 0, outputTokens: 0 }, price)).toBe(expected);
  });

  it('TC-M3-003 bills cached input at the cached rate without charging it twice', () => {
    const price = {
      ...sonnetPrice,
      inputPerMTokMicroUsd: microUsd(1_000_000),
      cachedInputPerMTokMicroUsd: microUsd(100_000),
      outputPerMTokMicroUsd: microUsd(0),
    };
    expect(computeTokenCost({ inputTokens: 1_000_000, cachedInputTokens: 400_000, outputTokens: 0 }, price)).toBe(
      640_000,
    );
  });

  it('TC-M3-004 computes a free tier call as zero while retaining a price entry', () => {
    const freePrice = {
      ...sonnetPrice,
      inputPerMTokMicroUsd: microUsd(0),
      cachedInputPerMTokMicroUsd: microUsd(0),
      outputPerMTokMicroUsd: microUsd(0),
      freeTier: true,
    };
    expect(computeTokenCost({ inputTokens: 100, cachedInputTokens: 50, outputTokens: 20 }, freePrice)).toBe(0);
    expect(findPrice({ ...table, entries: [freePrice] }, freePrice.modelKey)).toBe(freePrice);
  });

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
    expect(toVnd(microUsd(1), { ...fx, usdToVnd: 1e-7 })).toBe(0);
    expect(toVnd(microUsd(1), { ...fx, usdToVnd: 1e21 })).toBe(1_000_000_000_000_000);
  });

  it('TC-M3-007 retains maximum safe micro-USD and rejects an unsafe converted amount', () => {
    const largest = microUsd(Number.MAX_SAFE_INTEGER);
    expect(sumMicroUsd([largest])).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => toVnd(largest, { ...fx, usdToVnd: Number.MAX_SAFE_INTEGER })).toThrow(RangeError);
  });

  it('rejects a malformed decimal match without attempting to convert it', () => {
    const malformed = Object.assign(['26'], { index: 0, input: '26' }) as RegExpExecArray;
    const exec = vi.spyOn(RegExp.prototype, 'exec').mockReturnValueOnce(malformed);
    try {
      expect(() => toVnd(microUsd(1), fx)).toThrow(RangeError);
    } finally {
      exec.mockRestore();
    }
  });
});
