import { AsyncEntry } from '@napi-rs/keyring';
import { ErrorCode, type AppError, type ProviderId, type Result } from '@itstudio/schemas';
import type { ISecretStore } from '../ports/secret-store.js';

const SERVICE = 'itstudio';

function storeError(): AppError {
  return {
    code: ErrorCode.INTERNAL,
    message: 'The operating system credential store could not be accessed.',
    remediation: ['Check that Windows Credential Manager is available, then try again.'],
    retryable: true,
  };
}

export class KeychainSecretStore implements ISecretStore {
  async get(provider: ProviderId): Promise<Result<string | null>> {
    try {
      const value = await new AsyncEntry(SERVICE, provider).getPassword();
      return { ok: true, value: value ?? null };
    } catch {
      return { ok: false, error: storeError() };
    }
  }

  async set(provider: ProviderId, key: string): Promise<Result<void>> {
    try {
      await new AsyncEntry(SERVICE, provider).setPassword(key);
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: storeError() };
    }
  }

  async delete(provider: ProviderId): Promise<Result<void>> {
    try {
      await new AsyncEntry(SERVICE, provider).deleteCredential();
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: storeError() };
    }
  }
}
