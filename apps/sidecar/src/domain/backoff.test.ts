import { describe, expect, it } from 'vitest';
import { retryDelayMs } from './backoff.js';

describe('retryDelayMs', () => {
  it('applies injected ±20% jitter to the exponential default', () => {
    expect(retryDelayMs(2, undefined, () => 0)).toBe(1_600);
    expect(retryDelayMs(2, undefined, () => 0.5)).toBe(2_000);
    expect(retryDelayMs(2, undefined, () => 1)).toBe(2_400);
  });

  it('uses Retry-After and caps the base delay before jitter', () => {
    expect(retryDelayMs(0, 3_000, () => 0.5)).toBe(3_000);
    expect(retryDelayMs(8, 50_000, () => 0.5)).toBe(10_000);
  });
});
