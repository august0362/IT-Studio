import { describe, expect, it } from 'vitest';
import type { FxRate } from '@itstudio/schemas';
import { isoDateTimeSchema } from '../validation/brand.js';
import { formatUsd, formatVnd, parseUsdDecimal, toMoneyDisplay, usdStringToMicroUsd } from './money.js';
import { microUsd, vnd } from './cost.js';

const fx: FxRate = {
  usdToVnd: 25_000,
  asOf: isoDateTimeSchema.parse('2026-10-01T00:00:00.000Z'),
  source: 'auto',
};

describe('money display', () => {
  it.each([
    ['0', 0],
    ['1', 1_000_000],
    ['0.000001', 1],
    ['12.3405', 12_340_500],
    ['1000.000000', 1_000_000_000],
  ])('parses USD decimal %s to micro-USD', (value, expected) => {
    expect(parseUsdDecimal(value)).toBe(expected);
  });

  it.each(['', '.5', '1.', '-1', '1.0000001', '1000.000001', '1e2'])('rejects invalid USD decimal %s', (value) => {
    expect(() => parseUsdDecimal(value)).toThrow(RangeError);
  });
  it.each([
    [0, '$0.00'],
    [100, '$0.0001'],
    [999_990, '$1.0000'],
    [1_000_000, '$1.00'],
    [1_234_500_000, '$1,234.50'],
    [-500_000, '-$0.5000'],
    [-123_450_000, '-$123.45'],
  ])('formats USD %i as %s', (amount, expected) => {
    expect(formatUsd(microUsd(amount))).toBe(expected);
  });
  it.each([
    [0, '0 ₫'],
    [999, '999 ₫'],
    [1_000, '1.000 ₫'],
    [31_456, '31.456 ₫'],
    [-1_200, '-1.200 ₫'],
  ])('formats VND %i as %s', (amount, expected) => {
    expect(formatVnd(vnd(amount))).toBe(expected);
  });
  it('builds a dual-currency display with the FX timestamp', () => {
    expect(toMoneyDisplay(microUsd(-500_000), fx)).toEqual({
      microUsd: -500_000,
      vnd: -12_500,
      usdText: '-$0.5000',
      vndText: '-12.500 ₫',
      fxAsOf: fx.asOf,
    });
  });
});

describe('usdStringToMicroUsd', () => {
  it.each([
    ['0.000001', 1],
    ['12.5', 12_500_000],
  ])('parses %s exactly', (value, expected) => {
    expect(usdStringToMicroUsd(value)).toBe(expected);
  });
  it.each(['1e3', '-1', '', '0', '1.0000001', '9000000000000'])('rejects %s', (value) => {
    expect(usdStringToMicroUsd(value)).toBeNull();
  });
});
