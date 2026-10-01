import {
  ErrorCode,
  ProviderId,
  type AppError,
  type IsoDateTime,
  type ProviderId as ProviderIdType,
  type Result,
  type SecretStatus,
} from '@itstudio/schemas';
import type { IClock } from '../infra/clock.js';
import type { IProviderKeyVerifier } from '../infra/http/provider-key-verifier.js';
import type { ISecretStore } from '../ports/secret-store.js';
import { isoDateTimeSchema } from '../validation/brand.js';

export interface SecretsServiceDependencies {
  readonly store: ISecretStore;
  readonly verifier: IProviderKeyVerifier;
  readonly clock: IClock;
}

function validationError(message: string): Result<never> {
  return {
    ok: false,
    error: {
      code: ErrorCode.VALIDATION,
      message,
      remediation: ['Enter a valid API key and try again.'],
      retryable: false,
    },
  };
}

function internalError(): AppError {
  return {
    code: ErrorCode.INTERNAL,
    message: 'The secret store could not be accessed.',
    remediation: ['Check that the operating system credential store is available, then try again.'],
    retryable: true,
  };
}

export class SecretsService {
  private readonly store: ISecretStore;
  private readonly verifier: IProviderKeyVerifier;
  private readonly clock: IClock;
  private readonly lastVerifiedAt = new Map<ProviderIdType, string>();

  constructor(dependencies: SecretsServiceDependencies) {
    this.store = dependencies.store;
    this.verifier = dependencies.verifier;
    this.clock = dependencies.clock;
  }

  async set(provider: ProviderIdType, apiKey: string): Promise<Result<SecretStatus>> {
    const key = apiKey.trim();
    if (key.length === 0) return validationError('API key must not be empty.');
    if (key.length > 512) return validationError('API key must be 512 characters or fewer.');
    if (/\s|\p{Cc}/u.test(key)) return validationError('API key must not contain whitespace or control characters.');
    const stored = await this.store.set(provider, key);
    if (!stored.ok) return { ok: false, error: internalError() };
    return { ok: true, value: { provider, configured: true, hint: key.slice(-4), ...this.verified(provider) } };
  }

  async delete(provider: ProviderIdType): Promise<Result<SecretStatus>> {
    const deleted = await this.store.delete(provider);
    if (!deleted.ok) return { ok: false, error: internalError() };
    this.lastVerifiedAt.delete(provider);
    return { ok: true, value: { provider, configured: false } };
  }

  async status(): Promise<Result<readonly SecretStatus[]>> {
    const statuses: SecretStatus[] = [];
    for (const provider of Object.values(ProviderId)) {
      const stored = await this.store.get(provider);
      if (!stored.ok) return { ok: false, error: internalError() };
      statuses.push(
        stored.value === null
          ? { provider, configured: false }
          : { provider, configured: true, hint: stored.value.slice(-4), ...this.verified(provider) },
      );
    }
    return { ok: true, value: statuses };
  }

  async verify(provider: ProviderIdType): Promise<Result<SecretStatus>> {
    const stored = await this.store.get(provider);
    if (!stored.ok) return { ok: false, error: internalError() };
    if (stored.value === null) {
      return {
        ok: false,
        error: {
          code: ErrorCode.SECRET_MISSING,
          message: `No API key is configured for ${provider}.`,
          remediation: [`Enter an API key for ${provider}, then try again.`],
          retryable: false,
        },
      };
    }
    const verified = await this.verifier.verify(provider, stored.value);
    if (!verified.ok) {
      return {
        ok: false,
        error: {
          code: verified.error.code,
          message: `Could not verify the API key for ${provider}.`,
          remediation: ['Check the key and provider service, then try again.'],
          retryable: verified.error.retryable,
        },
      };
    }
    const timestamp = isoDateTimeSchema.parse(this.clock.now().toISOString());
    this.lastVerifiedAt.set(provider, timestamp);
    return {
      ok: true,
      value: { provider, configured: true, hint: stored.value.slice(-4), ...this.verified(provider) },
    };
  }

  private verified(provider: ProviderIdType): { readonly lastVerifiedAt: IsoDateTime } | Record<string, never> {
    const timestamp = this.lastVerifiedAt.get(provider);
    return timestamp === undefined ? {} : { lastVerifiedAt: isoDateTimeSchema.parse(timestamp) };
  }
}
