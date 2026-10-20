import { ProviderId } from '@itstudio/schemas';
import type { Seeds } from '../../kernel/config/load-seeds.js';
import { buildDefaultSettings } from '../../kernel/domain/default-settings.js';
import {
  FetchHttpClient,
  ProviderKeyVerifier,
  type IProviderKeyVerifier,
} from '../../kernel/infra/http/provider-key-verifier.js';
import { KeychainSecretStore } from '../../kernel/infra/keychain-secret-store.js';
import {
  SecretHistoryRepository,
  type ISecretHistoryRepository,
} from '../../kernel/infra/sqlite/secret-history-repository.js';
import { SettingsRepository } from '../../kernel/infra/sqlite/settings-repository.js';
import type { ModuleContext } from '../../kernel/module-context.js';
import type { IProcessTracker } from '../../kernel/ports/process-tracker.js';
import type { ISecretStore } from '../../kernel/ports/secret-store.js';
import { SecretsService } from './services/secrets-service.js';
import { SettingsService } from './services/settings-service.js';

export interface SettingsModuleDependencies {
  readonly processes: IProcessTracker;
  /** Overrides (tests, E2E doubles); the keychain, SQLite history and live key verifier are the defaults. */
  readonly secretStore?: ISecretStore | undefined;
  readonly secretHistory?: ISecretHistoryRepository | undefined;
  readonly keyVerifier?: IProviderKeyVerifier | undefined;
}

/** The cheapest enabled Qwen model with a seed price; its id is used to verify Qwen keys. */
function qwenVerificationModelId(seeds: Seeds): string | undefined {
  const qwenVerificationModel = seeds.pricing.entries
    .filter((entry) =>
      seeds.models.some((model) => model.key === entry.modelKey && model.provider === ProviderId.QWEN && model.enabled),
    )
    .toSorted(
      (a, b) => a.inputPerMTokMicroUsd + a.outputPerMTokMicroUsd - (b.inputPerMTokMicroUsd + b.outputPerMTokMicroUsd),
    )[0];
  return seeds.models.find((model) => model.key === qwenVerificationModel?.modelKey)?.providerModelId;
}

export function createSettingsModule(ctx: ModuleContext, deps: SettingsModuleDependencies) {
  const settings = new SettingsService({
    repository: new SettingsRepository(ctx.db),
    defaults: buildDefaultSettings(ctx.seeds),
    dataDir: ctx.filesDir,
    themeIds: new Set(ctx.seeds.themes.themes.map((theme) => theme.id)),
    clock: ctx.clock,
    logger: ctx.logger,
  });
  const secretStore = deps.secretStore ?? new KeychainSecretStore();
  const secrets = new SecretsService({
    processes: deps.processes,
    store: secretStore,
    history: deps.secretHistory ?? new SecretHistoryRepository(ctx.db),
    ids: ctx.ids,
    verifier:
      deps.keyVerifier ??
      new ProviderKeyVerifier(new FetchHttpClient(), () => settings.get(), qwenVerificationModelId(ctx.seeds)),
    clock: ctx.clock,
  });
  return { settings, secretStore, secrets };
}

export type SettingsModule = ReturnType<typeof createSettingsModule>;
export { SettingsService } from './services/settings-service.js';
export { SecretsService } from './services/secrets-service.js';
export { SystemService } from './services/system-service.js';
export { registerSettingsRpc } from './rpc.js';
