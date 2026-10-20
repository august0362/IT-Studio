import {
  ErrorCode,
  FALLBACK_TRIGGERS,
  FailureKind,
  type AppError,
  type FailureKind as FailureKindType,
  type ProviderId,
} from '@itstudio/schemas';

export interface FailureForAppError {
  readonly kind: FailureKindType;
}

export function parseRetryAfter(headerValue: string | null | undefined, now: Date | number): number | undefined {
  if (headerValue === null || headerValue === undefined || headerValue.trim() === '') return undefined;

  const value = headerValue.trim();
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.max(0, Math.round(Number(value) * 1_000));

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  return Math.max(0, timestamp - nowMs);
}

export function isFallbackTrigger(kind: FailureKindType): boolean {
  return FALLBACK_TRIGGERS.includes(kind);
}

export function failureToAppError(failure: FailureForAppError, provider: ProviderId, model: string): AppError {
  const withContext = (error: Omit<AppError, 'details'>): AppError => ({
    ...error,
    details: { provider, modelIdLength: model.length },
  });
  const context = 'The provider request';
  switch (failure.kind) {
    case FailureKind.RATE_LIMITED:
    case FailureKind.CIRCUIT_OPEN:
      return withContext({
        code: ErrorCode.PROVIDER_RATE_LIMITED,
        message: `${context} was rate limited.`,
        remediation: ['Wait for the provider limit to reset, or choose another model.'],
        retryable: true,
      });
    case FailureKind.QUOTA_EXHAUSTED:
      return withContext({
        code: ErrorCode.PROVIDER_QUOTA_EXHAUSTED,
        message: `${context} could not run because provider quota is exhausted.`,
        remediation: ['Check the provider billing page and increase or renew the available quota.'],
        retryable: false,
      });
    case FailureKind.SERVER_ERROR:
      return withContext({
        code: ErrorCode.PROVIDER_SERVER,
        message: `${context} failed because the provider is unavailable.`,
        remediation: ['Wait briefly and retry, or choose another model.'],
        retryable: true,
      });
    case FailureKind.TIMEOUT:
      return withContext({
        code: ErrorCode.PROVIDER_TIMEOUT,
        message: `${context} timed out.`,
        remediation: ['Retry with a shorter prompt or a model with a faster response.'],
        retryable: true,
      });
    case FailureKind.AUTH:
      return withContext({
        code: ErrorCode.PROVIDER_AUTH,
        message: `${context} was rejected because its credentials are invalid.`,
        remediation: ['Re-enter and verify the API key in Settings.'],
        retryable: false,
      });
    case FailureKind.BAD_REQUEST:
      return withContext({
        code: ErrorCode.PROVIDER_BAD_REQUEST,
        message: `${context} was rejected as invalid.`,
        remediation: ['Choose a supported model or adjust the request settings.'],
        retryable: false,
      });
    case FailureKind.CONTENT_FILTERED:
      return withContext({
        code: ErrorCode.PROVIDER_CONTENT_FILTERED,
        message: `${context} was blocked by the provider safety filter.`,
        remediation: ['Revise the prompt and try again.'],
        retryable: false,
      });
    case FailureKind.CAPABILITY_MISMATCH:
      return withContext({
        code: ErrorCode.LADDER_EXHAUSTED,
        message: `${context} does not support the required capability.`,
        remediation: ['Choose a model that supports this request.'],
        retryable: false,
      });
  }
}
