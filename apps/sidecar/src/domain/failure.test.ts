import { describe, expect, it } from 'vitest';
import { ErrorCode, FailureKind } from '@itstudio/schemas';
import { failureToAppError, isFallbackTrigger, parseRetryAfter } from './failure.js';
import type { ProviderFailure } from '../ports/llm-provider.js';

describe('parseRetryAfter', () => {
  const now = new Date('2026-10-02T00:00:00.000Z');

  it('parses seconds, including fractional and zero values', () => {
    expect(parseRetryAfter('3', now)).toBe(3_000);
    expect(parseRetryAfter('0.25', now)).toBe(250);
    expect(parseRetryAfter('0', now)).toBe(0);
  });

  it('parses an HTTP date relative to the supplied clock', () => {
    expect(parseRetryAfter('Fri, 02 Oct 2026 00:00:05 GMT', now)).toBe(5_000);
    expect(parseRetryAfter('Thu, 01 Oct 2026 23:59:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('Fri, 02 Oct 2026 00:00:05 GMT', now.getTime())).toBe(5_000);
  });

  it('returns undefined for missing, blank, and invalid values', () => {
    expect(parseRetryAfter(undefined, now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter(' ', now)).toBeUndefined();
    expect(parseRetryAfter('tomorrow', now)).toBeUndefined();
  });
});

describe('isFallbackTrigger', () => {
  it('identifies the configured fallback failures', () => {
    expect(isFallbackTrigger(FailureKind.RATE_LIMITED)).toBe(true);
    expect(isFallbackTrigger(FailureKind.QUOTA_EXHAUSTED)).toBe(true);
    expect(isFallbackTrigger(FailureKind.SERVER_ERROR)).toBe(true);
    expect(isFallbackTrigger(FailureKind.TIMEOUT)).toBe(true);
    expect(isFallbackTrigger(FailureKind.CIRCUIT_OPEN)).toBe(true);
    expect(isFallbackTrigger(FailureKind.CAPABILITY_MISMATCH)).toBe(true);
    expect(isFallbackTrigger(FailureKind.AUTH)).toBe(false);
    expect(isFallbackTrigger(FailureKind.BAD_REQUEST)).toBe(false);
    expect(isFallbackTrigger(FailureKind.CONTENT_FILTERED)).toBe(false);
  });
});

describe('failureToAppError', () => {
  const cases = [
    [FailureKind.RATE_LIMITED, ErrorCode.PROVIDER_RATE_LIMITED],
    [FailureKind.CIRCUIT_OPEN, ErrorCode.PROVIDER_RATE_LIMITED],
    [FailureKind.QUOTA_EXHAUSTED, ErrorCode.PROVIDER_QUOTA_EXHAUSTED],
    [FailureKind.SERVER_ERROR, ErrorCode.PROVIDER_SERVER],
    [FailureKind.TIMEOUT, ErrorCode.PROVIDER_TIMEOUT],
    [FailureKind.AUTH, ErrorCode.PROVIDER_AUTH],
    [FailureKind.BAD_REQUEST, ErrorCode.PROVIDER_BAD_REQUEST],
    [FailureKind.CONTENT_FILTERED, ErrorCode.PROVIDER_CONTENT_FILTERED],
    [FailureKind.CAPABILITY_MISMATCH, ErrorCode.LADDER_EXHAUSTED],
  ] as const;

  it.each(cases)('maps %s to %s with safe remediation', (kind, code) => {
    const providerFailure: ProviderFailure = {
      kind,
      message: 'unsafe provider body with key sk-sensitive',
      billed: false,
    };
    const error = failureToAppError(providerFailure, 'openai', 'sk-sensitive');
    expect(error.code).toBe(code);
    expect(error.message).not.toContain('unsafe provider body');
    expect(error.message).not.toContain('sk-sensitive');
    expect(error.remediation).toHaveLength(1);
  });
});
