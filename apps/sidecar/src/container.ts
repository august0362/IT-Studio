import { FailureKind, ProviderId, type RpcNotificationMap } from '@itstudio/schemas';
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
import { ChatRepository } from './infra/sqlite/chat-repository.js';
import { LedgerRepository } from './infra/sqlite/ledger-repository.js';
import { ProjectService } from './services/project-service.js';
import { SettingsService } from './services/settings-service.js';
import { ChatService } from './services/chat-service.js';
import { RouterConfigService } from './services/router-config-service.js';
import { UserFallbackDecider } from './services/fallback-decider.js';
import { KeychainSecretStore } from './infra/keychain-secret-store.js';
import { FetchHttpClient, ProviderKeyVerifier } from './infra/http/provider-key-verifier.js';
import { SecretsService } from './services/secrets-service.js';
import type { ISecretStore } from './ports/secret-store.js';
import type { IProviderKeyVerifier } from './infra/http/provider-key-verifier.js';
import { ProviderRegistry } from './providers/provider-registry.js';
import type { ILlmProvider, ProviderRequest, ProviderResponse } from './ports/llm-provider.js';
import type { ProviderId as ProviderIdType } from '@itstudio/schemas';
import { AnthropicProvider } from './providers/anthropic/anthropic-provider.js';
import { GoogleProvider } from './providers/google/google-provider.js';
import {
  OPENAI_COMPATIBLE_BASE_URLS,
  OpenAiCompatibleProvider,
} from './providers/openai-compatible/openai-compatible-provider.js';
import { ModelRegistry } from './services/model-registry.js';
import { AlwaysOkBudgetGuard } from './ports/budget-guard.js';
import { LlmRouter, type RouterCompleted } from './services/llm-router.js';
import { computeTokenCost } from './domain/cost.js';
import { isoDateTimeSchema } from './validation/brand.js';
import { LedgerService } from './services/ledger-service.js';
import { SeedPriceSource } from './services/price-source.js';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
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

function scriptedLlmProvider(id: ProviderIdType, text: string): ILlmProvider {
  const response = (request: ProviderRequest): ProviderResponse => ({
    text,
    toolCalls: [],
    usage: { inputTokens: 12, outputTokens: 8, cachedInputTokens: 0 },
    finishReason: 'stop',
    providerModelId: request.modelId,
  });
  const unavailable = (
    kind: FailureKind,
  ): Result<never, { readonly kind: FailureKind; readonly billed: false; readonly message: string }> => ({
    ok: false,
    error: { kind, billed: false, message: 'Scripted fixture request was cancelled.' },
  });
  return {
    id,
    complete: (request, _apiKey, signal) =>
      Promise.resolve(signal.aborted ? unavailable(FailureKind.SERVER_ERROR) : { ok: true, value: response(request) }),
    stream: (request, _apiKey, signal, onDelta) => {
      if (signal.aborted) return Promise.resolve(unavailable(FailureKind.SERVER_ERROR));
      const chunks = text.match(/.{1,12}/gu) ?? [];
      for (const chunk of chunks) onDelta(chunk);
      return Promise.resolve({ ok: true, value: response(request) });
    },
    listModels: () => Promise.resolve({ ok: true, value: [] }),
  };
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
  const startupStartedAt = (dependencies.clock ?? systemClock).monotonicMs();
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
  for (const warning of loadedSeeds.value.warnings)
    logger.warn({ svc: 'sidecar', warning }, 'Seed configuration warning');
  const database = openDatabase(dataDir);
  const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), 'infra/sqlite/migrations');
  const migrationsApplied = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).length;
  const projectRepository = new ProjectRepository(database.db);
  const chatRepository = new ChatRepository(database.db);
  const ledgerRepository = new LedgerRepository(database.db);
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
  const secretStore = dependencies.secretStore ?? (e2e ? new MemorySecretStore() : new KeychainSecretStore());
  const secretsService = new SecretsService({
    store: secretStore,
    verifier:
      dependencies.keyVerifier ??
      (e2e
        ? new ScriptedKeyVerifier(env.ITSTUDIO_E2E_VERIFIER_OUTCOME)
        : new ProviderKeyVerifier(new FetchHttpClient())),
    clock,
  });
  const providers = new ProviderRegistry({
    [ProviderId.ANTHROPIC]: () =>
      e2e
        ? scriptedLlmProvider(ProviderId.ANTHROPIC, env.ITSTUDIO_E2E_LLM_TEXT ?? 'Scripted assistant reply.')
        : new AnthropicProvider(),
    [ProviderId.GOOGLE]: () =>
      e2e
        ? scriptedLlmProvider(ProviderId.GOOGLE, env.ITSTUDIO_E2E_LLM_TEXT ?? 'Scripted assistant reply.')
        : new GoogleProvider(),
    [ProviderId.OPENAI]: () =>
      e2e
        ? scriptedLlmProvider(ProviderId.OPENAI, env.ITSTUDIO_E2E_LLM_TEXT ?? 'Scripted assistant reply.')
        : new OpenAiCompatibleProvider({
            id: ProviderId.OPENAI,
            baseURL: OPENAI_COMPATIBLE_BASE_URLS[ProviderId.OPENAI],
          }),
    [ProviderId.XAI]: () =>
      e2e
        ? scriptedLlmProvider(ProviderId.XAI, env.ITSTUDIO_E2E_LLM_TEXT ?? 'Scripted assistant reply.')
        : new OpenAiCompatibleProvider({ id: ProviderId.XAI, baseURL: OPENAI_COMPATIBLE_BASE_URLS[ProviderId.XAI] }),
    [ProviderId.GROQ]: () =>
      e2e
        ? scriptedLlmProvider(ProviderId.GROQ, env.ITSTUDIO_E2E_LLM_TEXT ?? 'Scripted assistant reply.')
        : new OpenAiCompatibleProvider({ id: ProviderId.GROQ, baseURL: OPENAI_COMPATIBLE_BASE_URLS[ProviderId.GROQ] }),
    [ProviderId.TOGETHER]: () =>
      e2e
        ? scriptedLlmProvider(ProviderId.TOGETHER, env.ITSTUDIO_E2E_LLM_TEXT ?? 'Scripted assistant reply.')
        : new OpenAiCompatibleProvider({
            id: ProviderId.TOGETHER,
            baseURL: OPENAI_COMPATIBLE_BASE_URLS[ProviderId.TOGETHER],
          }),
  });
  const modelRegistry = new ModelRegistry(loadedSeeds.value.models, providers);
  const events = new EventBus<RpcNotificationMap>();
  const routerCompleted = new EventBus<{ completed: RouterCompleted }>();
  const priceSource = new SeedPriceSource(loadedSeeds.value.pricing, {
    usdToVnd: loadedSeeds.value.fx.seedUsdToVnd,
    asOf: isoDateTimeSchema.parse(loadedSeeds.value.fx.seedAsOf),
    source: 'auto',
  });
  const ledgerService = new LedgerService({
    repository: ledgerRepository,
    prices: priceSource,
    completed: routerCompleted,
    events,
    ids,
    clock,
    logger,
  });
  const routerConfigService = new RouterConfigService({ settings: settingsService, models: modelRegistry });
  const fallbackDecider = new UserFallbackDecider({
    events,
    clock,
    models: modelRegistry,
    priceTable: () => loadedSeeds.value.pricing,
  });
  const llmRouter = new LlmRouter({
    models: modelRegistry,
    providers,
    secrets: secretStore,
    budget: new AlwaysOkBudgetGuard(),
    estimateCostMicroUsd: (request, modelKey) => {
      const price = loadedSeeds.value.pricing.entries.find((entry) => entry.modelKey === modelKey);
      if (price === undefined) return 0;
      const promptText = [
        request.systemPrompt ?? '',
        ...request.messages.flatMap((message) =>
          message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
        ),
      ].join(' ');
      const model = modelRegistry.get(modelKey);
      return computeTokenCost(
        {
          inputTokens: Math.ceil(promptText.length / 4),
          outputTokens: request.maxOutputTokens ?? model?.maxOutputTokens ?? 0,
          cachedInputTokens: 0,
        },
        price,
      );
    },
    config: async () => {
      const settings = await settingsService.get();
      return settings.ok ? { ok: true, value: settings.value.router } : settings;
    },
    clock,
    ids,
    logger,
    events,
    completed: routerCompleted,
    fallbackDecider,
  });
  const chatService = new ChatService({
    repository: chatRepository,
    router: llmRouter,
    ledger: ledgerService,
    events,
    ids,
    clock,
    logger,
  });
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
    logger,
    ...(dependencies.exit === undefined ? {} : { exit: dependencies.exit }),
  });
  service.register(server);
  server.register('settings.get', () => settingsService.get());
  server.register('settings.update', ({ patch }) => settingsService.update(patch));
  server.register('router.getConfig', () => routerConfigService.getConfig());
  server.register('router.updateConfig', ({ config }) => routerConfigService.updateConfig(config));
  server.register('router.resolveFallback', (decision) =>
    Promise.resolve({ ok: true, value: fallbackDecider.resolve(decision) }),
  );
  server.register('project.list', () => projectService.list());
  server.register('project.create', ({ name, workspaceRoot }) => projectService.create(name, workspaceRoot));
  server.register('project.setActive', ({ projectId }) => projectService.setActive(projectId));
  server.register('secrets.set', ({ provider, apiKey }) => secretsService.set(provider, apiKey));
  server.register('secrets.delete', ({ provider }) => secretsService.delete(provider));
  server.register('secrets.status', () => secretsService.status());
  server.register('secrets.verify', ({ provider }) => secretsService.verify(provider));
  server.register('models.list', () => Promise.resolve({ ok: true, value: modelRegistry.list() }));
  server.register('chat.listConversations', ({ projectId }) => chatService.listConversations(projectId));
  server.register('chat.createConversation', ({ projectId, title }) =>
    chatService.createConversation(projectId, title),
  );
  server.register('chat.getMessages', ({ conversationId }) => chatService.getMessages(conversationId));
  server.register('chat.send', ({ conversationId, text, modelOverride }) =>
    chatService.send(conversationId, text, modelOverride),
  );
  server.register('chat.cancel', ({ requestId }) => chatService.cancel(requestId));
  server.register('ledger.query', (query) => ledgerService.query(query));

  return {
    clock,
    ids,
    database,
    settingsService,
    secretsService,
    providers,
    modelRegistry,
    llmRouter,
    chatService,
    ledgerService,
    routerCompleted,
    projectService,
    events,
    logger,
    server,
    start(): void {
      logger.info(
        { svc: 'sidecar', version: service.getVersion(), nodeVersion: process.version, dataDir },
        'sidecar starting',
      );
      logger.info({ svc: 'sidecar', count: migrationsApplied }, 'migrations applied');
      logger.info(
        { svc: 'sidecar', models: loadedSeeds.value.models.length, warningsCount: loadedSeeds.value.warnings.length },
        'seeds loaded',
      );
      transport.start();
      events.publish('system.ready', { version: service.getVersion(), recoveredTransactions: 0 });
      logger.info({ svc: 'sidecar', startupMs: Math.max(0, clock.monotonicMs() - startupStartedAt) }, 'sidecar ready');
    },
  };
}
