import type { FxRate, MicroUsd, PriceEntry, PriceTable, TokenUsage, Vnd } from '@itstudio/schemas';

const MICRO_USD_PER_USD = 1_000_000n;

function integer(value: number, name: string): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer`);
  }
  return BigInt(value);
}

function nonNegative(value: number, name: string): bigint {
  const result = integer(value, name);
  if (result < 0n) {
    throw new RangeError(`${name} must be non-negative`);
  }
  return result;
}

/** Create integer micro-USD. Signed values are supported for margins. */
export function microUsd(value: number): MicroUsd {
  integer(value, 'microUsd');
  return value as MicroUsd;
}

/** Create integer Vietnamese đồng. Signed values are supported for margins. */
export function vnd(value: number): Vnd {
  integer(value, 'vnd');
  return value as Vnd;
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function fromBigInt(value: bigint): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || BigInt(converted) !== value) {
    throw new RangeError('Computed amount is outside the safe integer range');
  }
  return converted;
}

function costFromTokenCounts(
  inputTokens: bigint,
  cachedInputTokens: bigint,
  outputTokens: bigint,
  price: PriceEntry,
): MicroUsd {
  const inputRate = nonNegative(price.inputPerMTokMicroUsd, 'input price');
  const cachedRate = nonNegative(price.cachedInputPerMTokMicroUsd, 'cached input price');
  const outputRate = nonNegative(price.outputPerMTokMicroUsd, 'output price');
  const billableInput = inputTokens - cachedInputTokens;
  const numerator = billableInput * inputRate + cachedInputTokens * cachedRate + outputTokens * outputRate;
  return microUsd(fromBigInt(ceilDivide(numerator, MICRO_USD_PER_USD)));
}

export function computeTokenCost(usage: TokenUsage, price: PriceEntry): MicroUsd {
  const inputTokens = nonNegative(usage.inputTokens, 'inputTokens');
  const outputTokens = nonNegative(usage.outputTokens, 'outputTokens');
  const reportedCached = nonNegative(usage.cachedInputTokens, 'cachedInputTokens');
  // Providers occasionally report more cached tokens than input tokens; cap at input.
  const cachedInputTokens = reportedCached > inputTokens ? inputTokens : reportedCached;
  return costFromTokenCounts(inputTokens, cachedInputTokens, outputTokens, price);
}

export interface ImageCost {
  readonly cost: MicroUsd;
  readonly missingPrice: boolean;
}

export function computeImageCost(count: number, price: PriceEntry): ImageCost {
  const imageCount = nonNegative(count, 'count');
  if (price.perImageMicroUsd === undefined) {
    return { cost: microUsd(0), missingPrice: true };
  }
  const unitPrice = nonNegative(price.perImageMicroUsd, 'image price');
  return {
    cost: microUsd(fromBigInt(imageCount * unitPrice)),
    missingPrice: false,
  };
}

export function estimateRequestCost(promptChars: number, maxOutputTokens: number, price: PriceEntry): MicroUsd {
  const chars = nonNegative(promptChars, 'promptChars');
  const outputTokens = nonNegative(maxOutputTokens, 'maxOutputTokens');
  const promptTokens = ceilDivide(chars, 4n);
  return costFromTokenCounts(promptTokens, 0n, outputTokens, price);
}

export function findPrice(table: PriceTable, modelKey: PriceEntry['modelKey']): PriceEntry | undefined {
  return table.entries.find((entry) => entry.modelKey === modelKey);
}

export function sumMicroUsd(amounts: readonly MicroUsd[]): MicroUsd {
  const total = amounts.reduce((sum, amount) => sum + integer(amount, 'amount'), 0n);
  return microUsd(fromBigInt(total));
}

/** Convert micro-USD to VND using an exact decimal representation of the configured FX rate. */
export function toVnd(amount: MicroUsd, fx: FxRate): Vnd {
  const rateText = fx.usdToVnd.toString().toLowerCase();
  const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/.exec(rateText);
  if (match === null || !Number.isFinite(fx.usdToVnd) || fx.usdToVnd < 0) {
    throw new RangeError('usdToVnd must be a finite non-negative number');
  }
  const integerPart = match[1];
  if (integerPart === undefined) {
    throw new RangeError('usdToVnd must be a finite non-negative number');
  }
  const fraction = match[2] ?? '';
  const exponent = Number(match[3] ?? '0');
  let numerator = BigInt(`${integerPart}${fraction}`);
  let denominator = 10n ** BigInt(fraction.length);
  if (exponent > 0) numerator *= 10n ** BigInt(exponent);
  if (exponent < 0) denominator *= 10n ** BigInt(-exponent);

  const product = integer(amount, 'amount') * numerator;
  const divisor = denominator * MICRO_USD_PER_USD;
  const magnitude = product < 0n ? -product : product;
  let rounded = magnitude / divisor;
  if ((magnitude % divisor) * 2n >= divisor) rounded += 1n;
  return vnd(fromBigInt(product < 0n ? -rounded : rounded));
}
