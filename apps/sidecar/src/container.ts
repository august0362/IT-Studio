import { ProviderId, type RpcNotificationMap } from '@itstudio/schemas';
import { stdin, stdout } from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Readable, Writable } from 'node:stream';
import type { Logger } from 'pino';
import { systemClock, type IClock } from './infra/clock.js';
import { createLogger } from './infra/logger.js';
import { systemIdGenerator, type IIdGenerator } from './infra/id.js';
import { EventBus } from './rpc/event-bus.js';
import { LineTransport } from './rpc/line-transport.js';
import { RpcServer } from './rpc/rpc-server.js';
import { SystemService } from './services/system-service.js';
import { loadSeeds } from './config/load-seeds.js';
import { buildDefaultSettings } from './domain/default-settings.js';
import { openDatabase } from './infra/sqlite/database.js';
import { ProjectRepository } from './infra/sqlite/project-repository.js';
import { SettingsRepository } from './infra/sqlite/settings-repository.js';
import { ProjectService } from './services/project-service.js';
import { SettingsService } from './services/settings-service.js';
import { KeychainSecretStore } from './infra/keychain-secret-store.js';
import { FetchHttpClient, ProviderKeyVerifier } from './infra/http/provider-key-verifier.js';
import { SecretsService } from './services/secrets-service.js';
import type { ISecretStore } from './ports/secret-store.js';
import type { IProviderKeyVerifier } from './infra/http/provider-key-verifier.js';
import { ProviderRegistry } from './providers/provider-registry.js';
import { AnthropicProvider } from './providers/anthropic/anthropic-provider.js';
import { GoogleProvider } from './providers/google/google-provider.js';
import {
  OPENAI_COMPATIBLE_BASE_URLS,
  OpenAiCompatibleProvider,
} from './providers/openai-compatible/openai-compatible-provider.js';
import { ModelRegistry } from './services/model-registry.js';
import { readFileSync } from 'node:fs';
import { ErrorCode, type AppError, type Result } from '@itstudio/schemas';
import { z } from 'zod';

class MemorySecretStore implements ISecretStore {
  private readonly values = new Map<ProviderId, string>();

  get(provider: ProviderId): Promise<Result<string | null>> {
    return Promise.resolve({ ok: true, value: this.values.get(provider) ?? null });
  }

  set(provider: ProviderId, key: string): Promise<Result<void>> {
    this.values.set(provider, key);
    return Promise.resolve({ ok: true, value: undefined });
  }

  delete(provider: ProviderId): Promise<Result<void>> {
    this.values.delete(provider);
    return Promise.resolve({ ok: true, value: undefined });
  }
}

type VerifierOutcome = 'success' | 'auth' | 'server' | 'timeout';
const verifierOutcomeSchema = z.enum(['success', 'auth', 'server', 'timeout']);
const verifierFixtureSchema = z.record(z.string(), verifierOutcomeSchema);

class ScriptedKeyVerifier implements IProviderKeyVerifier {
  private readonly outcomes: Readonly<Record<string, VerifierOutcome>>;
  private readonly override: VerifierOutcome | undefined;

  constructor(override: string | undefined) {
    const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), '../test/integration/fixtures/verifier.json');
    this.outcomes = verifierFixtureSchema.parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
    const parsedOverride = verifierOutcomeSchema.safeParse(override);
    this.override = parsedOverride.success ? parsedOverride.data : undefined;
  }

  async verify(provider: ProviderId): Promise<Result<void>> {
    const outcome = this.override ?? this.outcomes[provider] ?? 'success';
    if (outcome === 'success') return { ok: true, value: undefined };
    if (outcome === 'timeout') {
      await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 10_000));
      const error: AppError = {
        code: ErrorCode.PROVIDER_TIMEOUT,
        message: `The ${provider} verification request timed out.`,
        retryable: true,
        remediation: ['Try verifying the API key again.'],
      };
      return { ok: false, error };
    }
    if (outcome === 'auth') {
      return {
        ok: false,
        error: {
          code: ErrorCode.PROVIDER_AUTH,
          message: `The API key for ${provider} was rejected.`,
          retryable: false,
          remediation: [`Re-enter the API key for ${provider}.`],
        },
      };
    }
    return {
      ok: false,
      error: {
        code: ErrorCode.PROVIDER_SERVER,
        message: `The ${provider} service is unavailable.`,
        retryable: true,
        remediation: ['Try verifying the API key again shortly.'],
      },
    };
  }
}

export interface ContainerDependencies {
  readonly input?: Readable;
  readonly output?: Writable;
  readonly clock?: IClock;
  readonly ids?: IIdGenerator;
  readonly logger?: Logger;
  readonly exit?: (code: number) => void;
  readonly dataDir?: string;
  readonly secretStore?: ISecretStore;
  readonly keyVerifier?: IProviderKeyVerifier;
}

export function createContainer(env: NodeJS.ProcessEnv, dependencies: ContainerDependencies = {}) {
  const clock = dependencies.clock ?? systemClock;
  const logger =
    dependencies.logger ??
    createLogger({
      ...(env.ITSTUDIO_DATA_DIR === undefined ? {} : { dataDir: env.ITSTUDIO_DATA_DIR }),
      ...(env.ITSTUDIO_LOG_LEVEL === undefined ? {} : { level: env.ITSTUDIO_LOG_LEVEL }),
    });
  const ids = dependencies.ids ?? systemIdGenerator;
  const dataDir = dependencies.dataDir ?? env.ITSTUDIO_DATA_DIR ?? resolve('data');
  const e2e = env.ITSTUDIO_E2E === '1';
  const loadedSeeds = loadSeeds(resolve(dirname(fileURLToPath(import.meta.url)), '../../..', 'config'));
  if (!loadedSeeds.ok) throw new Error(loadedSeeds.error.message);
  for (const warning of loadedSeeds.value.warnings) logger.warn({ warning }, 'Seed configuration warning');
  const database = openDatabase(dataDir);
  const projectRepository = new ProjectRepository(database.db);
  const settingsRepository = new SettingsRepository(database.db);
  const settingsService = new SettingsService({
    repository: settingsRepository,
    defaults: buildDefaultSettings(loadedSeeds.value),
    dataDir: dataDir === ':memory:' ? resolve('.') : dataDir,
    themeIds: new Set(loadedSeeds.value.themes.themes.map((theme) => theme.id)),
    clock,
    logger,
  });
  const projectService = new ProjectService({ repository: projectRepository, settings: settingsService, ids, clock });
  const secretsService = new SecretsService({
    store: dependencies.secretStore ?? (e2e ? new MemorySecretStore() : new KeychainSecretStore()),
    verifier:
      dependencies.keyVerifier ??
      (e2e
        ? new ScriptedKeyVerifier(env.ITSTUDIO_E2E_VERIFIER_OUTCOME)
        : new ProviderKeyVerifier(new FetchHttpClient())),
    clock,
  });
  const providers = new ProviderRegistry({
    [ProviderId.ANTHROPIC]: () => new AnthropicProvider(),
    [ProviderId.GOOGLE]: () => new GoogleProvider(),
    [ProviderId.OPENAI]: () =>
      new OpenAiCompatibleProvider({ id: ProviderId.OPENAI, baseURL: OPENAI_COMPATIBLE_BASE_URLS[ProviderId.OPENAI] }),
    [ProviderId.XAI]: () =>
      new OpenAiCompatibleProvider({ id: ProviderId.XAI, baseURL: OPENAI_COMPATIBLE_BASE_URLS[ProviderId.XAI] }),
    [ProviderId.GROQ]: () =>
      new OpenAiCompatibleProvider({ id: ProviderId.GROQ, baseURL: OPENAI_COMPATIBLE_BASE_URLS[ProviderId.GROQ] }),
    [ProviderId.TOGETHER]: () =>
      new OpenAiCompatibleProvider({
        id: ProviderId.TOGETHER,
        baseURL: OPENAI_COMPATIBLE_BASE_URLS[ProviderId.TOGETHER],
      }),
  });
  const modelRegistry = new ModelRegistry(loadedSeeds.value.models, providers);
  const events = new EventBus<RpcNotificationMap>();
  const serverRef: { current?: RpcServer } = {};
  const transport = new LineTransport({
    input: dependencies.input ?? stdin,
    output: dependencies.output ?? stdout,
    onLine: async (line) => {
      await serverRef.current?.handleLine(line);
    },
  });
  const server = new RpcServer(transport, events, logger);
  serverRef.current = server;
  const service = new SystemService({
    clock,
    startedAt: clock.monotonicMs(),
    ...(dependencies.exit === undefined ? {} : { exit: dependencies.exit }),
  });
  service.register(server);
  server.register('settings.get', () => settingsService.get());
  server.register('settings.update', ({ patch }) => settingsService.update(patch));
  server.register('project.list', () => projectService.list());
  server.register('project.create', ({ name, workspaceRoot }) => projectService.create(name, workspaceRoot));
  server.register('project.setActive', ({ projectId }) => projectService.setActive(projectId));
  server.register('secrets.set', ({ provider, apiKey }) => secretsService.set(provider, apiKey));
  server.register('secrets.delete', ({ provider }) => secretsService.delete(provider));
  server.register('secrets.status', () => secretsService.status());
  server.register('secrets.verify', ({ provider }) => secretsService.verify(provider));
  server.register('models.list', () => Promise.resolve({ ok: true, value: modelRegistry.list() }));

  return {
    clock,
    ids,
    database,
    settingsService,
    secretsService,
    providers,
    modelRegistry,
    projectService,
    events,
    logger,
    server,
    start(): void {
      transport.start();
      events.publish('system.ready', { version: service.getVersion(), recoveredTransactions: 0 });
    },
  };
}
