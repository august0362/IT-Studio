import type { ProcessId } from '@itstudio/schemas';
import type { IProcessTracker } from '../ports/process-tracker.js';
import { trackProcess } from './process-activity.js';
import {
  ErrorCode,
  ProviderId,
  type AppError,
  type IsoDateTime,
  type ProviderId as ProviderIdType,
  type Result,
  SecretHistoryAction,
  type SecretHistoryEntry,
  type SecretStatus,
} from '@itstudio/schemas';
import type { IClock } from '../infra/clock.js';
import type { IProviderKeyVerifier } from '../infra/http/provider-key-verifier.js';
import type { IIdGenerator } from '../infra/id.js';
import type { ISecretHistoryRepository } from '../infra/sqlite/secret-history-repository.js';
import type { ISecretStore } from '../ports/secret-store.js';
import { isoDateTimeSchema, secretHistoryIdSchema } from '../validation/brand.js';

export interface SecretsServiceDependencies {
  readonly processes?: IProcessTracker;
  readonly store: ISecretStore;
  readonly verifier: IProviderKeyVerifier;
  readonly history: ISecretHistoryRepository;
  readonly ids: IIdGenerator;
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

function recoveryError(): AppError {
  return {
    code: ErrorCode.INTERNAL,
    message: 'API key history could not be written and the previous key state could not be restored.',
    remediation: ['Reload API key status before retrying.'],
    retryable: true,
    details: { keyStateMayHaveChanged: true },
  };
}

export class SecretsService {
  private readonly processes: IProcessTracker | undefined;
  private readonly store: ISecretStore;
  private readonly verifier: IProviderKeyVerifier;
  private readonly historyRepository: ISecretHistoryRepository;
  private readonly ids: IIdGenerator;
  private readonly clock: IClock;
  private readonly lastVerifiedAt = new Map<ProviderIdType, string>();

  constructor(dependencies: SecretsServiceDependencies) {
    this.processes = dependencies.processes;
    this.store = dependencies.store;
    this.verifier = dependencies.verifier;
    this.historyRepository = dependencies.history;
    this.ids = dependencies.ids;
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
    const existing = await this.store.get(provider);
    if (!existing.ok) return { ok: false, error: internalError() };
    const deleted = await this.store.delete(provider);
    if (!deleted.ok) return { ok: false, error: internalError() };
    try {
      this.historyRepository.append(
        this.historyEntry(provider, existing.value?.slice(-4) ?? '', SecretHistoryAction.DELETED, null),
      );
    } catch {
      if (existing.value !== null && !(await this.restoreKeyState(provider, existing.value))) {
        this.lastVerifiedAt.delete(provider);
        return { ok: false, error: recoveryError() };
      }
      return { ok: false, error: internalError() };
    }
    this.lastVerifiedAt.delete(provider);
    return { ok: true, value: { provider, configured: false } };
  }

  async verifyAndSave(provider: ProviderIdType, apiKey: string): Promise<Result<SecretStatus>> {
    const key = this.validatedKey(apiKey);
    if (!key.ok) return key;
    const previous = await this.store.get(provider);
    if (!previous.ok) return { ok: false, error: internalError() };
    const verified = await this.verifyTracked(provider, key.value);
    if (!verified.ok) {
      try {
        this.historyRepository.append(
          this.historyEntry(provider, key.value.slice(-4), SecretHistoryAction.VERIFY_FAILED, verified.error.code),
        );
      } catch {
        // Keep the provider verification error as the useful result for the caller.
      }
      return { ok: false, error: this.verificationError(provider, verified.error) };
    }
    const stored = await this.store.set(provider, key.value);
    if (!stored.ok) return { ok: false, error: internalError() };
    const timestamp = isoDateTimeSchema.parse(this.clock.now().toISOString());
    try {
      this.historyRepository.append(this.historyEntry(provider, key.value.slice(-4), SecretHistoryAction.SAVED, null));
    } catch {
      if (!(await this.restoreKeyState(provider, previous.value))) {
        this.lastVerifiedAt.delete(provider);
        return { ok: false, error: recoveryError() };
      }
      return { ok: false, error: internalError() };
    }
    this.lastVerifiedAt.set(provider, timestamp);
    return {
      ok: true,
      value: { provider, configured: true, hint: key.value.slice(-4), ...this.verified(provider) },
    };
  }

  history(provider?: ProviderIdType, limit = 50): Result<readonly SecretHistoryEntry[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return validationError('History limit must be 1–50.');
    try {
      return { ok: true, value: this.historyRepository.list(provider, limit) };
    } catch {
      return { ok: false, error: internalError() };
    }
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

  async verify(provider: ProviderIdType, retryOf?: ProcessId): Promise<Result<SecretStatus>> {
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
    const verified = await this.verifyTracked(provider, stored.value, retryOf);
    if (!verified.ok) {
      try {
        this.historyRepository.append(
          this.historyEntry(provider, stored.value.slice(-4), SecretHistoryAction.VERIFY_FAILED, verified.error.code),
        );
      } catch {
        // Keep the provider verification error as the useful result for the caller.
      }
      return {
        ok: false,
        error: this.verificationError(provider, verified.error),
      };
    }
    const timestamp = isoDateTimeSchema.parse(this.clock.now().toISOString());
    this.lastVerifiedAt.set(provider, timestamp);
    return {
      ok: true,
      value: { provider, configured: true, hint: stored.value.slice(-4), ...this.verified(provider) },
    };
  }

  private async verifyTracked(provider: ProviderIdType, key: string, retryOf?: ProcessId): Promise<Result<void>> {
    const controller = new AbortController();
    const activity = trackProcess(this.processes, 'key_verify', {
      title: 'Verify key: ' + provider,
      operation: { kind: 'key_verify', params: { provider } },
      cancel: () => {
        controller.abort();
        return Promise.resolve({ ok: true, value: undefined });
      },
      ...(retryOf === undefined ? {} : { retryOf }),
    });
    activity.done('input', 'Key ending in ****' + key.slice(-4));
    activity.step('request', provider);
    try {
      const result =
        this.processes === undefined
          ? await this.verifier.verify(provider, key)
          : await this.verifier.verify(provider, key, controller.signal);
      if (controller.signal.aborted) {
        activity.fail('Key verification was cancelled');
        return {
          ok: false,
          error: {
            code: ErrorCode.CANCELLED,
            message: 'Key verification was cancelled.',
            retryable: true,
            remediation: ['Retry verification when ready.'],
          },
        };
      }
      if (result.ok) {
        activity.step('result');
        activity.finish('Key verified');
      } else activity.fail(this.verificationError(provider, result.error));
      return result;
    } catch {
      activity.fail('Key verification failed unexpectedly');
      return { ok: false, error: internalError() };
    }
  }

  private async restoreKeyState(provider: ProviderIdType, previous: string | null): Promise<boolean> {
    try {
      const restored = previous === null ? await this.store.delete(provider) : await this.store.set(provider, previous);
      return restored.ok;
    } catch {
      return false;
    }
  }

  private verified(provider: ProviderIdType): { readonly lastVerifiedAt: IsoDateTime } | Record<string, never> {
    const timestamp = this.lastVerifiedAt.get(provider);
    return timestamp === undefined ? {} : { lastVerifiedAt: isoDateTimeSchema.parse(timestamp) };
  }

  private validatedKey(apiKey: string): Result<string> {
    const key = apiKey.trim();
    if (key.length === 0) return validationError('API key must not be empty.');
    if (key.length > 512) return validationError('API key must be 512 characters or fewer.');
    if (/\s|\p{Cc}/u.test(key)) return validationError('API key must not contain whitespace or control characters.');
    return { ok: true, value: key };
  }

  private historyEntry(
    provider: ProviderIdType,
    hint: string,
    action: SecretHistoryEntry['action'],
    resultCode: SecretHistoryEntry['resultCode'],
  ): SecretHistoryEntry {
    return {
      id: secretHistoryIdSchema.parse(this.ids.uuid()),
      provider,
      hint,
      action,
      resultCode,
      at: isoDateTimeSchema.parse(this.clock.now().toISOString()),
    };
  }

  private verificationError(provider: ProviderIdType, error: AppError): AppError {
    const remediation =
      error.code === ErrorCode.PROVIDER_AUTH
        ? ['The provider rejected this key.']
        : error.code === ErrorCode.PROVIDER_TIMEOUT
          ? ['The provider did not answer in time — check your network and try again; the key was not saved.']
          : ['Check the key and provider service, then try again.'];
    return {
      code: error.code,
      message: `Could not verify the API key for ${provider}.`,
      remediation,
      retryable: error.retryable,
    };
  }
}
