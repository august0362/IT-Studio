import {
  FailureKind,
  ProviderId,
  type ProjectId,
  type RpcNotificationMap,
  type WorkspaceRelativePath,
} from '@itstudio/schemas';
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
import { BudgetRepository } from './infra/sqlite/budget-repository.js';
import { PriceRepository } from './infra/sqlite/price-repository.js';
import { FxRepository } from './infra/sqlite/fx-repository.js';
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
import type { ILlmProvider, ProviderFailure, ProviderRequest, ProviderResponse } from './ports/llm-provider.js';
import type { ProviderId as ProviderIdType } from '@itstudio/schemas';
import { AnthropicProvider } from './providers/anthropic/anthropic-provider.js';
import { GoogleProvider } from './providers/google/google-provider.js';
import {
  OPENAI_COMPATIBLE_BASE_URLS,
  OpenAiCompatibleProvider,
} from './providers/openai-compatible/openai-compatible-provider.js';
import { ModelRegistry } from './services/model-registry.js';
import { BudgetGuard } from './services/budget-guard.js';
import { LlmRouter, type RouterCompleted } from './services/llm-router.js';
import { computeTokenCost } from './domain/cost.js';
import { LedgerService } from './services/ledger-service.js';
import { RepositoryPriceSource } from './services/price-source.js';
import { FxService } from './services/fx-service.js';
import { FxDailyJob } from './scheduler/daily-job.js';
import type { IHttpClient } from './ports/http-client.js';
import { PricingService } from './services/pricing-service.js';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { ErrorCode, type AppError, type Result } from '@itstudio/schemas';
import { z } from 'zod';
import { VSCodeBridge } from './services/vscode-bridge.js';

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

const scriptedLlmFixtureSchema = z.object({ models: z.record(z.string(), z.array(z.string())) });

function scriptedLlmProvider(
  id: ProviderIdType,
  text: string,
  scripts: Readonly<Record<string, readonly string[]>>,
  cursors: Map<string, number>,
): ILlmProvider {
  const response = (request: ProviderRequest): ProviderResponse => ({
    text,
    toolCalls: [],
    usage: { inputTokens: 12, outputTokens: 8, cachedInputTokens: 0 },
    finishReason: 'stop',
    providerModelId: request.modelId,
  });
  const next = (request: ProviderRequest): string => {
    const key = `${id}/${request.modelId}`;
    const cursor = cursors.get(key) ?? 0;
    cursors.set(key, cursor + 1);
    return scripts[key]?.[cursor] ?? scripts[request.modelId]?.[cursor] ?? 'ok';
  };
  const wait = async (ms: number, signal: AbortSignal): Promise<boolean> => {
    if (signal.aborted) return false;
    await new Promise<void>((resolveDelay) => {
      const timer = setTimeout(resolveDelay, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolveDelay();
        },
        { once: true },
      );
    });
    return !signal.aborted;
  };
  const failed = (outcome: string): Result<never, ProviderFailure> => {
    if (outcome === 'quota')
      return {
        ok: false,
        error: { kind: FailureKind.QUOTA_EXHAUSTED, billed: false, message: 'Scripted quota failure.' },
      };
    if (outcome === 'auth')
      return {
        ok: false,
        error: { kind: FailureKind.AUTH, billed: false, httpStatus: 401, message: 'Scripted authentication failure.' },
      };
    if (outcome === 'content_filter')
      return {
        ok: false,
        error: { kind: FailureKind.CONTENT_FILTERED, billed: false, message: 'Scripted content filter.' },
      };
    const http = /^http:(\d{3})(?::(\d+))?$/u.exec(outcome);
    if (http !== null) {
      const status = Number(http[1]);
      const kind =
        status === 429 ? FailureKind.RATE_LIMITED : status >= 500 ? FailureKind.SERVER_ERROR : FailureKind.SERVER_ERROR;
      return {
        ok: false,
        error: {
          kind,
          billed: false,
          httpStatus: status,
          ...(http[2] === undefined ? {} : { retryAfterMs: Number(http[2]) }),
          message: `Scripted HTTP ${String(status)} failure with body key ${['sk', 'fake', 'provider', 'error', 'body'].join('-')}.`,
        },
      };
    }
    return {
      ok: false,
      error: { kind: FailureKind.SERVER_ERROR, billed: false, message: 'Unknown scripted outcome.' },
    };
  };
  const run = async (
    request: ProviderRequest,
    signal: AbortSignal,
    onDelta?: (chunk: string) => void,
  ): Promise<Result<ProviderResponse, ProviderFailure>> => {
    const outcome = next(request);
    const delay = /^delay:(\d+)$/u.exec(outcome);
    if (delay !== null && !(await wait(Number(delay[1]), signal)))
      return { ok: false, error: { kind: FailureKind.TIMEOUT, billed: false, message: 'Scripted request cancelled.' } };
    if (signal.aborted)
      return { ok: false, error: { kind: FailureKind.TIMEOUT, billed: false, message: 'Scripted request cancelled.' } };
    const stream = /^stream:(\d+)$/u.exec(outcome);
    const chunks = text.match(/.{1,12}/gu) ?? [text];
    if (stream !== null) {
      const count = Number(stream[1]);
      for (let index = 0; index < count; index += 1) onDelta?.(chunks[index % Math.max(1, chunks.length)] ?? 'x');
    } else if (outcome === 'ok' || outcome.startsWith('delay:')) {
      if (onDelta !== undefined) for (const chunk of chunks) onDelta(chunk);
    } else {
      if (onDelta !== undefined && outcome.startsWith('http:')) {
        const chunks = text.match(/.{1,12}/gu) ?? [text];
        onDelta(chunks.at(0) ?? 'partial');
        onDelta(chunks.at(1) ?? 'partial');
      }
      return failed(outcome);
    }
    return { ok: true, value: response(request) };
  };
  return {
    id,
    complete: (request, _apiKey, signal) => run(request, signal),
    stream: (request, _apiKey, signal, onDelta) => run(request, signal, onDelta),
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
  readonly fxHttpClient?: IHttpClient;
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
  const vscodeBridgeEnabled = dataDir !== ':memory:' || e2e;
  const llmScripts =
    e2e && env.ITSTUDIO_E2E_LLM_SCRIPT !== undefined
      ? scriptedLlmFixtureSchema.parse(JSON.parse(readFileSync(env.ITSTUDIO_E2E_LLM_SCRIPT, 'utf8'))).models
      : {};
  const llmScriptCursors = new Map<string, number>();
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
  const budgetRepository = new BudgetRepository(database.db);
  const priceRepository = new PriceRepository(database.db);
  const fxRepository = new FxRepository(database.db);
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
  const fxHttpClient: IHttpClient =
    dependencies.fxHttpClient ??
    (e2e
      ? { request: () => Promise.resolve(Response.json({ rates: { VND: loadedSeeds.value.fx.seedUsdToVnd } })) }
      : new FetchHttpClient());
  const fxService = new FxService({
    repository: fxRepository,
    http: fxHttpClient,
    settings: settingsService,
    config: loadedSeeds.value.fx,
    clock,
    logger,
  });
  const fxDailyJob = new FxDailyJob({ fx: fxService, settings: settingsService, clock, logger });
  const providers = new ProviderRegistry({
    [ProviderId.ANTHROPIC]: () =>
      e2e
        ? scriptedLlmProvider(
            ProviderId.ANTHROPIC,
            env.ITSTUDIO_E2E_LLM_TEXT ?? 'Scripted assistant reply.',
            llmScripts,
            llmScriptCursors,
          )
        : new AnthropicProvider(),
    [ProviderId.GOOGLE]: () =>
      e2e
        ? scriptedLlmProvider(
            ProviderId.GOOGLE,
            env.ITSTUDIO_E2E_LLM_TEXT ?? 'Scripted assistant reply.',
            llmScripts,
            llmScriptCursors,
          )
        : new GoogleProvider(),
    [ProviderId.OPENAI]: () =>
      e2e
        ? scriptedLlmProvider(
            ProviderId.OPENAI,
            env.ITSTUDIO_E2E_LLM_TEXT ?? 'Scripted assistant reply.',
            llmScripts,
            llmScriptCursors,
          )
        : new OpenAiCompatibleProvider({
            id: ProviderId.OPENAI,
            baseURL: OPENAI_COMPATIBLE_BASE_URLS[ProviderId.OPENAI],
          }),
    [ProviderId.XAI]: () =>
      e2e
        ? scriptedLlmProvider(
            ProviderId.XAI,
            env.ITSTUDIO_E2E_LLM_TEXT ?? 'Scripted assistant reply.',
            llmScripts,
            llmScriptCursors,
          )
        : new OpenAiCompatibleProvider({ id: ProviderId.XAI, baseURL: OPENAI_COMPATIBLE_BASE_URLS[ProviderId.XAI] }),
    [ProviderId.GROQ]: () =>
      e2e
        ? scriptedLlmProvider(
            ProviderId.GROQ,
            env.ITSTUDIO_E2E_LLM_TEXT ?? 'Scripted assistant reply.',
            llmScripts,
            llmScriptCursors,
          )
        : new OpenAiCompatibleProvider({ id: ProviderId.GROQ, baseURL: OPENAI_COMPATIBLE_BASE_URLS[ProviderId.GROQ] }),
    [ProviderId.TOGETHER]: () =>
      e2e
        ? scriptedLlmProvider(
            ProviderId.TOGETHER,
            env.ITSTUDIO_E2E_LLM_TEXT ?? 'Scripted assistant reply.',
            llmScripts,
            llmScriptCursors,
          )
        : new OpenAiCompatibleProvider({
            id: ProviderId.TOGETHER,
            baseURL: OPENAI_COMPATIBLE_BASE_URLS[ProviderId.TOGETHER],
          }),
  });
  const modelRegistry = new ModelRegistry(loadedSeeds.value.models, providers);
  const pricingService = new PricingService({
    repository: priceRepository,
    seed: loadedSeeds.value.pricing,
    knownModels: new Set(modelRegistry.list().map((model) => model.key)),
    ids,
    clock,
  });
  pricingService.initialize();
  const events = new EventBus<RpcNotificationMap>();
  const vscodeInternalEvents = new EventBus<{
    file_saved_by_user: { readonly projectId: ProjectId; readonly path: WorkspaceRelativePath; readonly hash: string };
  }>();
  const vscodeBridge = new VSCodeBridge({
    ids,
    logger,
    events: {
      publishStatus: (value) => {
        events.publish('vscode.status', value);
      },
      publishDiagnostics: (value) => {
        events.publish('vscode.diagnostics', value);
      },
      publishInternal: (value) => {
        vscodeInternalEvents.publish('file_saved_by_user', value);
      },
    },
  });
  const routerCompleted = new EventBus<{ completed: RouterCompleted }>();
  const priceSource = new RepositoryPriceSource(priceRepository, fxService);
  const ledgerService = new LedgerService({
    repository: ledgerRepository,
    prices: priceSource,
    completed: routerCompleted,
    events,
    ids,
    clock,
    logger,
  });
  const budgetGuard = new BudgetGuard({
    repository: budgetRepository,
    settings: settingsService,
    prices: priceSource,
    events,
    clock,
  });
  const routerConfigService = new RouterConfigService({ settings: settingsService, models: modelRegistry });
  const fallbackDecider = new UserFallbackDecider({
    events,
    clock,
    models: modelRegistry,
    priceTable: () => pricingService.current(),
  });
  const llmRouter = new LlmRouter({
    models: modelRegistry,
    providers,
    secrets: secretStore,
    budget: budgetGuard,
    estimateCostMicroUsd: (request, modelKey) => {
      const price = pricingService.current().entries.find((entry) => entry.modelKey === modelKey);
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
    ...(e2e ? { sleep: () => Promise.resolve() } : {}),
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
  const systemServiceRef: { current?: SystemService } = {};
  const serverRef: { current?: RpcServer } = {};
  const transport = new LineTransport({
    input: dependencies.input ?? stdin,
    output: dependencies.output ?? stdout,
    onLine: async (line) => {
      await serverRef.current?.handleLine(line);
    },
    onEnd: () => systemServiceRef.current?.shutdown('stdin_closed'),
  });
  const server = new RpcServer(transport, events, logger);
  serverRef.current = server;
  let fxJobStopped = false;
  const service = new SystemService({
    clock,
    startedAt: clock.monotonicMs(),
    logger,
    shutdownHooks: [
      () => {
        fxJobStopped = true;
        return vscodeBridge.stop();
      },
      () => {
        fxJobStopped = true;
        fxDailyJob.stop();
      },
    ],
    ...(dependencies.exit === undefined ? {} : { exit: dependencies.exit }),
  });
  systemServiceRef.current = service;
  service.register(server);
  server.register('settings.get', () => settingsService.get());
  server.register('settings.update', ({ patch }) => settingsService.update(patch));
  server.register('fx.get', () => fxService.get());
  server.register('fx.override', ({ usdToVnd }) => fxService.override(usdToVnd));
  server.register('router.getConfig', () => routerConfigService.getConfig());
  server.register('router.updateConfig', ({ config }) => routerConfigService.updateConfig(config));
  server.register('router.resolveFallback', (decision) =>
    Promise.resolve({ ok: true, value: fallbackDecider.resolve(decision) }),
  );
  server.register('project.list', () => projectService.list());
  server.register('project.create', ({ name, workspaceRoot }) => projectService.create(name, workspaceRoot));
  server.register('project.setActive', async ({ projectId }) => {
    const result = await projectService.setActive(projectId);
    if (result.ok && vscodeBridgeEnabled) {
      try {
        await vscodeBridge.activate(result.value.id, result.value.workspaceRoot);
      } catch (error) {
        logger.error(
          { svc: 'vscode-bridge', projectId, error: error instanceof Error ? error.message : 'unknown' },
          'Could not prepare VS Code session',
        );
      }
    }
    return result;
  });
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
  server.register('budget.set', ({ projectId, period, limitMicroUsd, warnAt }) =>
    budgetGuard.set({ projectId, period, limitMicroUsd, warnAt }),
  );
  server.register('budget.status', ({ projectId }) => budgetGuard.status(projectId));
  server.register('pricing.get', () => Promise.resolve({ ok: true, value: pricingService.current() }));
  server.register('pricing.override', ({ entry }) => Promise.resolve(pricingService.override(entry)));

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
    budgetGuard,
    pricingService,
    fxService,
    routerCompleted,
    projectService,
    vscodeBridge,
    vscodeInternalEvents,
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
      void fxService.initialize().then(
        () => {
          if (!fxJobStopped) fxDailyJob.start();
        },
        (error: unknown) => {
          if (!fxJobStopped) {
            logger.warn(
              { svc: 'fx', error: error instanceof Error ? error.message : 'unknown' },
              'FX initialization failed',
            );
          }
          if (!fxJobStopped) fxDailyJob.start();
        },
      );
      void (async () => {
        if (!vscodeBridgeEnabled) return;
        const settings = await settingsService.get();
        if (!settings.ok || settings.value.activeProjectId === null) return;
        const projects = await projectService.list();
        if (!projects.ok) return;
        const activeProject = projects.value.find((project) => project.id === settings.value.activeProjectId);
        if (activeProject === undefined) return;
        await vscodeBridge.activate(activeProject.id, activeProject.workspaceRoot);
      })().catch((error: unknown) => {
        logger.error(
          { svc: 'vscode-bridge', error: error instanceof Error ? error.message : 'unknown' },
          'Could not restore active VS Code session',
        );
      });
      events.publish('system.ready', { version: service.getVersion(), recoveredTransactions: 0 });
      logger.info({ svc: 'sidecar', startupMs: Math.max(0, clock.monotonicMs() - startupStartedAt) }, 'sidecar ready');
    },
  };
}
