import { FailureKind } from '@itstudio/schemas';
import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../infra/clock.js';
import { modelKeySchema } from '../validation/common.js';
import { CircuitBreaker } from './circuit-breaker.js';

const modelKey = modelKeySchema.parse('openai/test-model');

describe('CircuitBreaker', () => {
  it('keeps an unknown model closed and does not emit a change for closed success', () => {
    const changes: string[] = [];
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 100 }, createFakeClock(), (_model, status) =>
      changes.push(status),
    );
    expect(breaker.status(modelKey)).toBe('closed');
    breaker.success(modelKey);
    expect(changes).toEqual([]);
  });

  it('TC-M2-023 opens at the configured consecutive-failure threshold and allows one probe', () => {
    const clock = createFakeClock();
    const changes: string[] = [];
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 100 }, clock, (_model, status) =>
      changes.push(status),
    );

    breaker.failure(modelKey, FailureKind.RATE_LIMITED);
    expect(breaker.status(modelKey)).toBe('closed');
    breaker.failure(modelKey, FailureKind.SERVER_ERROR);
    expect(breaker.status(modelKey)).toBe('open');
    expect(breaker.acquire(modelKey)).toBe(false);

    clock.advance(100);
    expect(breaker.status(modelKey)).toBe('half_open');
    expect(breaker.acquire(modelKey)).toBe(true);
    expect(breaker.acquire(modelKey)).toBe(false);
    breaker.success(modelKey);
    expect(breaker.status(modelKey)).toBe('closed');
    expect(changes).toEqual(['open', 'half_open', 'closed']);
  });

  it('TC-M2-023 remains closed below threshold and opens on the threshold failure', () => {
    const clock = createFakeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 100 }, clock, () => undefined);
    breaker.failure(modelKey, FailureKind.RATE_LIMITED);
    breaker.failure(modelKey, FailureKind.TIMEOUT);
    expect(breaker.status(modelKey)).toBe('closed');
    breaker.failure(modelKey, FailureKind.SERVER_ERROR);
    expect(breaker.status(modelKey)).toBe('open');
    clock.advance(100);
    expect(breaker.status(modelKey)).toBe('half_open');
  });

  it('keeps quota circuits open for at least one hour', () => {
    const clock = createFakeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 100 }, clock, () => undefined);
    breaker.failure(modelKey, FailureKind.QUOTA_EXHAUSTED);

    clock.advance(3_599_999);
    expect(breaker.status(modelKey)).toBe('open');
    clock.advance(1);
    expect(breaker.status(modelKey)).toBe('half_open');
  });

  it('resets the consecutive failure count after a non-fallback failure', () => {
    const clock = createFakeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 100 }, clock, () => undefined);
    breaker.failure(modelKey, FailureKind.RATE_LIMITED);
    breaker.failure(modelKey, FailureKind.AUTH);
    breaker.failure(modelKey, FailureKind.RATE_LIMITED);
    expect(breaker.status(modelKey)).toBe('closed');
    expect(breaker.acquire(modelKey)).toBe(true);
  });
});
