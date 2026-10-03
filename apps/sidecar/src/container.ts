import {
  FailureKind,
  CostPurpose,
  ProviderId,
  PipelineStage,
  type ProjectId,
  type RpcNotificationMap,
  type VSCodeStatus,
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
import { RevenueRepository } from './infra/sqlite/revenue-repository.js';
import { BudgetRepository } from './infra/sqlite/budget-repository.js';
import { PriceRepository } from './infra/sqlite/price-repository.js';
import { FxRepository } from './infra/sqlite/fx-repository.js';
import { ActivityRepository } from './infra/sqlite/activity-repository.js';
import { ActivityRecorder } from './services/activity-recorder.js';
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
import { PnLService } from './services/pnl-service.js';
import { RevenueService } from './services/revenue-service.js';
import { RepositoryPriceSource } from './services/price-source.js';
import { FxService } from './services/fx-service.js';
import { FxDailyJob } from './scheduler/daily-job.js';
import type { IHttpClient } from './ports/http-client.js';
import { PricingService } from './services/pricing-service.js';
import { PricingUpdater } from './services/pricing-updater.js';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { ErrorCode, type AppError, type Result } from '@itstudio/schemas';
import { z } from 'zod';
import { VSCodeBridge } from './services/vscode-bridge.js';
import { VSCodeLauncher } from './services/vscode-launcher.js';
import { NodeFileSystem } from './infra/node-file-system.js';
import { NodeProcessRunner } from './infra/node-process-runner.js';
import { NodeCodeCliRunner } from './infra/node-code-cli-runner.js';
import { PipelineRepository } from './infra/sqlite/pipeline-repository.js';
import { RoleCaller } from './services/role-caller.js';
import { WriteTransactionService } from './services/write-transaction.js';
import { CommandRunner } from './services/command-runner.js';
import { FailureReportBuilder } from './services/failure-report-builder.js';
import { JournalRecoveryService } from './services/journal-recovery.js';
import { ProjectContextService } from './services/project-context.js';
import { PipelineOrchestrator } from './services/pipeline-orchestrator.js';
import { microUsd, toMoneyDisplay } from './domain/money.js';
import { OpenAiEmbeddingProvider } from './providers/embedding/openai.js';
import { GoogleEmbeddingProvider } from './providers/embedding/google.js';
import { FakeEmbeddingProvider } from './infra/fake-embedding-provider.js';
import { EmbeddingDispatcher } from './services/embedding-dispatcher.js';
import { LanceDbVectorStore } from './infra/lancedb/vector-store.js';
import { DocumentRepository } from './infra/sqlite/document-repository.js';
import { RagService } from './services/rag/rag-service.js';
import { Retriever } from './services/rag/retriever.js';
import { ImageRepository } from './infra/sqlite/image-repository.js';
import { ImageService } from './services/image-service.js';
import { OpenAiDalle3Provider } from './providers/image/openai-dalle3.js';
import { FluxTogetherProvider } from './providers/image/flux-together.js';
import { FluxReplicateProvider } from './providers/image/flux-replicate.js';
import { FakeImageProvider } from './infra/fake-image-provider.js';
import { isoDateTimeSchema } from './validation/brand.js';
import { toolCallSchema } from './validation/chat.js';
import { jsonObjectSchema } from './validation/common.js';

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

  constructor(override: string | undefined, fixturePathOverride: string | undefined) {
    const fixturePath =
      fixturePathOverride ??
      resolve(dirname(fileURLToPath(import.meta.url)), '../test/integration/fixtures/verifier.json');
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
const embeddingOutcomeSchema = z.enum(['ok', 'http:503', 'quota', 'auth']);
const embeddingScriptSchema = z.record(z.string(), z.array(embeddingOutcomeSchema));
const scriptedLlmTextsSchema = z.record(z.string(), z.string());
const scriptedToolCallSchema = z.object({
  name: z.enum(['generate_image', 'search_knowledge']),
  arguments: jsonObjectSchema,
});

export function scriptedLlmProvider(
  id: ProviderIdType,
  texts: string | Readonly<Record<string, string>>,
  scripts: Readonly<Record<string, readonly string[]>>,
  cursors: Map<string, number>,
): ILlmProvider {
  const outputText = (request: ProviderRequest): string =>
    typeof texts === 'string' ? texts : (texts[request.modelId] ?? '{}');
  const response = (request: ProviderRequest, outcome: string): ProviderResponse => {
    const toolPrefix = 'tool:';
    let toolCalls: ProviderResponse['toolCalls'] = [];
    if (outcome.startsWith(toolPrefix)) {
      const raw: unknown = JSON.parse(outcome.slice(toolPrefix.length));
      const fixture = scriptedToolCallSchema.parse(raw);
      toolCalls = [toolCallSchema.parse({ id: 'call_scripted', ...fixture })];
    }
    return {
      text: toolCalls.length > 0 ? '' : outputText(request),
      toolCalls,
      usage: { inputTokens: 12, outputTokens: 8, cachedInputTokens: 0 },
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      providerModelId: request.modelId,
    };
  };
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
    if (outcome.startsWith('tool:')) return { ok: true, value: response(request, outcome) };
    const stream = /^stream:(\d+)$/u.exec(outcome);
    const text = outputText(request);
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
    return { ok: true, value: response(request, outcome) };
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
  readonly pricingHttpClient?: IHttpClient;
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
  const embeddingScripts =
    e2e && env.ITSTUDIO_E2E_EMBEDDING_SCRIPT !== undefined
      ? embeddingScriptSchema.parse(JSON.parse(readFileSync(env.ITSTUDIO_E2E_EMBEDDING_SCRIPT, 'utf8')))
      : {};
  const embeddingScriptCursors = new Map<string, number>();
  const configuredLlmText = env.ITSTUDIO_E2E_LLM_TEXT ?? 'Scripted assistant reply.';
  let llmTexts: string | Readonly<Record<string, string>> = configuredLlmText;
  try {
    const parsedText: unknown = JSON.parse(configuredLlmText) as unknown;
    const parsedTexts = scriptedLlmTextsSchema.safeParse(parsedText);
    if (parsedTexts.success) llmTexts = parsedTexts.data;
  } catch {
    // Plain response text remains the default fixture format.
  }
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
  const imageRepository = new ImageRepository(database.db);
  const ledgerRepository = new LedgerRepository(database.db);
  const revenueRepository = new RevenueRepository(database.db);
  const budgetRepository = new BudgetRepository(database.db);
  const priceRepository = new PriceRepository(database.db);
  const fxRepository = new FxRepository(database.db);
  const activityRepository = new ActivityRepository(database.db);
  const documentRepository = new DocumentRepository(database.db);
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
        ? new ScriptedKeyVerifier(env.ITSTUDIO_E2E_VERIFIER_OUTCOME, env.ITSTUDIO_E2E_VERIFIER_FIXTURE)
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
      e2e ? scriptedLlmProvider(ProviderId.ANTHROPIC, llmTexts, llmScripts, llmScriptCursors) : new AnthropicProvider(),
    [ProviderId.GOOGLE]: () =>
      e2e ? scriptedLlmProvider(ProviderId.GOOGLE, llmTexts, llmScripts, llmScriptCursors) : new GoogleProvider(),
    [ProviderId.OPENAI]: () =>
      e2e
        ? scriptedLlmProvider(ProviderId.OPENAI, llmTexts, llmScripts, llmScriptCursors)
        : new OpenAiCompatibleProvider({
            id: ProviderId.OPENAI,
            baseURL: OPENAI_COMPATIBLE_BASE_URLS[ProviderId.OPENAI],
          }),
    [ProviderId.XAI]: () =>
      e2e
        ? scriptedLlmProvider(ProviderId.XAI, llmTexts, llmScripts, llmScriptCursors)
        : new OpenAiCompatibleProvider({ id: ProviderId.XAI, baseURL: OPENAI_COMPATIBLE_BASE_URLS[ProviderId.XAI] }),
    [ProviderId.GROQ]: () =>
      e2e
        ? scriptedLlmProvider(ProviderId.GROQ, llmTexts, llmScripts, llmScriptCursors)
        : new OpenAiCompatibleProvider({ id: ProviderId.GROQ, baseURL: OPENAI_COMPATIBLE_BASE_URLS[ProviderId.GROQ] }),
    [ProviderId.TOGETHER]: () =>
      e2e
        ? scriptedLlmProvider(ProviderId.TOGETHER, llmTexts, llmScripts, llmScriptCursors)
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
  const pricingHttpClient: IHttpClient =
    dependencies.pricingHttpClient ??
    (e2e
      ? {
          request: () => {
            if (env.ITSTUDIO_E2E_PRICING_HTTP === 'fail')
              return Promise.reject(new Error('Scripted pricing network failure.'));
            return Promise.resolve(
              new Response(
                readFileSync(
                  resolve(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/pricing/pricing.html'),
                  'utf8',
                ),
                { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
              ),
            );
          },
        }
      : new FetchHttpClient());
  const events = new EventBus<RpcNotificationMap>();
  const activityRecorder = new ActivityRecorder({
    events,
    repository: activityRepository,
    ids,
    clock,
    settings: settingsService,
    aggregateCost: (amount) => toMoneyDisplay(microUsd(amount), fxService.getEffective()),
    vscodeBridgeAvailable: vscodeBridgeEnabled,
  });
  const fileSystem = new NodeFileSystem();
  let vscodeConnected = false;
  let vscodeStatus: VSCodeStatus = {
    installed: false,
    extensionInstalled: false,
    connected: false,
  };
  const vscodeInternalEvents = new EventBus<{
    file_saved_by_user: { readonly projectId: ProjectId; readonly path: WorkspaceRelativePath; readonly hash: string };
  }>();
  const vscodeBridge = new VSCodeBridge({
    ids,
    logger,
    events: {
      publishStatus: (value) => {
        vscodeConnected = value.connected;
        vscodeStatus = {
          ...vscodeStatus,
          connected: value.connected,
          ...(value.workspaceRoot === undefined ? {} : { workspaceRoot: value.workspaceRoot }),
          ...(value.extensionVersion === undefined ? {} : { extensionVersion: value.extensionVersion }),
        };
        events.publish('vscode.status', vscodeStatus);
      },
      publishDiagnostics: (value) => {
        events.publish('vscode.diagnostics', value);
      },
      publishInternal: (value) => {
        vscodeInternalEvents.publish('file_saved_by_user', value);
      },
    },
  });
  const vscodeLauncher = new VSCodeLauncher({
    fileSystem,
    runner: new NodeCodeCliRunner(env),
    logger,
    events: {
      publishStatus: (value) => {
        vscodeStatus = { ...value, connected: vscodeConnected };
        events.publish('vscode.status', vscodeStatus);
      },
    },
    env,
    platform: process.platform,
    repositoryRoot: resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
    e2e,
    connected: () => vscodeConnected,
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
  const pnlService = new PnLService({
    ledger: ledgerRepository,
    revenue: revenueRepository,
    projects: projectRepository,
    fx: priceSource,
  });
  const revenueService = new RevenueService({
    repository: revenueRepository,
    projects: projectRepository,
    fx: fxService,
    ids,
    clock,
  });
  const budgetGuard = new BudgetGuard({
    repository: budgetRepository,
    settings: settingsService,
    prices: priceSource,
    events,
    clock,
  });
  const imageProviders = e2e
    ? [new FakeImageProvider()]
    : [
        new OpenAiDalle3Provider(secretStore),
        new FluxTogetherProvider(secretStore, new FetchHttpClient()),
        new FluxReplicateProvider(secretStore, new FetchHttpClient()),
      ];
  const imageService = new ImageService({
    repository: imageRepository,
    ledger: ledgerRepository,
    budget: budgetGuard,
    settings: settingsService,
    providers: imageProviders,
    prices: priceSource,
    fileSystem,
    dataDir: dataDir === ':memory:' ? resolve('.') : dataDir,
    ids,
    clock,
    logger,
  });
  const embeddingProviders = {
    [ProviderId.OPENAI]: e2e
      ? new FakeEmbeddingProvider(ProviderId.OPENAI, embeddingScripts, embeddingScriptCursors)
      : new OpenAiEmbeddingProvider(),
    [ProviderId.GOOGLE]: e2e
      ? new FakeEmbeddingProvider(ProviderId.GOOGLE, embeddingScripts, embeddingScriptCursors)
      : new GoogleEmbeddingProvider(),
  };
  const embeddingDispatcher = {
    embed: async (
      texts: readonly string[],
      context: { readonly projectId: ProjectId; readonly purpose: 'embedding' },
    ) => {
      const currentSettings = await settingsService.get();
      if (!currentSettings.ok) return currentSettings;
      const dispatcher = new EmbeddingDispatcher({
        config: currentSettings.value.rag.embedding,
        models: loadedSeeds.value.models,
        providers: embeddingProviders,
        secrets: secretStore,
        ids,
        budget: budgetGuard,
        estimateCostMicroUsd: (modelKey, input) => {
          const price = pricingService.current().entries.find((entry) => entry.modelKey === modelKey);
          if (price === undefined) return 0;
          return computeTokenCost(
            {
              inputTokens: input.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
              outputTokens: 0,
              cachedInputTokens: 0,
            },
            price,
          );
        },
        completed: routerCompleted,
        ...(e2e ? { sleep: () => Promise.resolve() } : {}),
      });
      return dispatcher.embed(texts, context);
    },
  };
  const vectorStore = new LanceDbVectorStore(resolve(dataDir, 'lancedb'));
  const retriever = new Retriever({
    documents: documentRepository,
    vectors: vectorStore,
    embeddings: embeddingDispatcher,
    settings: settingsService,
  });
  const ragService = new RagService({
    projects: projectRepository,
    documents: documentRepository,
    fileSystem,
    vectors: vectorStore,
    embeddings: embeddingDispatcher,
    retriever,
    settings: settingsService,
    events,
    ids,
    clock,
    logger,
    embeddingCost: async (projectId, startedAt) => {
      let cursor: string | undefined;
      let total = 0;
      do {
        const page = await ledgerService.query({
          projectId,
          from: isoDateTimeSchema.parse(startedAt),
          purposes: [CostPurpose.EMBEDDING],
          limit: 500,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!page.ok) return total;
        total += page.value.items.reduce((sum, entry) => sum + entry.costMicroUsd, 0);
        cursor = page.value.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return total;
    },
  });
  const routerConfigService = new RouterConfigService({ settings: settingsService, models: modelRegistry });
  const fallbackDecider = new UserFallbackDecider({
    events,
    clock,
    models: modelRegistry,
    priceTable: () => pricingService.current(),
    fxRate: () => fxService.getEffective(),
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
    retriever,
    settings: settingsService,
    images: imageService,
  });
  const pricingUpdater = new PricingUpdater({
    settings: settingsService,
    projects: projectRepository,
    pricing: pricingService,
    router: llmRouter,
    http: pricingHttpClient,
    sources: loadedSeeds.value.pricingSources,
    models: modelRegistry.list(),
    events,
    ids,
    clock,
    logger,
  });
  const pipelineRepository = new PipelineRepository(database.db);
  const roleCaller = new RoleCaller({ router: llmRouter, logger, ids, now: () => clock.now() });
  const writeTransaction = new WriteTransactionService({ fileSystem, ids, clock });
  const commandRunner = new CommandRunner({ processRunner: new NodeProcessRunner(), fileSystem, ids });
  const journalRecovery = new JournalRecoveryService(fileSystem, clock);
  const projectContext = new ProjectContextService(fileSystem);
  const failureReportBuilder = new FailureReportBuilder();
  const pipelineOrchestrator = new PipelineOrchestrator({
    repository: pipelineRepository,
    projects: projectRepository,
    settings: async () => {
      const result = await settingsService.get();
      return result.ok ? { ok: true, value: result.value.pipeline } : result;
    },
    context: projectContext,
    roles: roleCaller,
    writer: writeTransaction,
    commands: commandRunner,
    reports: failureReportBuilder,
    fileSystem,
    events,
    ids,
    clock,
    runCost: (runId) => ledgerRepository.sumByPipelineRun(runId),
    moneyDisplay: (amount) => toMoneyDisplay(amount, fxService.getEffective()),
    budgetHardStop: async (projectId) => {
      const status = await budgetGuard.status(projectId);
      return status.ok && status.value.some((item) => item.blocking);
    },
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
      () => {
        activityRecorder.stop();
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
        const settings = await settingsService.get();
        if (settings.ok)
          await vscodeLauncher.activate({ workspaceRoot: result.value.workspaceRoot, settings: settings.value.vscode });
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
  server.register('chat.setRagEnabled', ({ conversationId, enabled }) =>
    chatService.setRagEnabled(conversationId, enabled),
  );
  server.register('chat.send', async ({ conversationId, text, modelOverride }) => {
    const conversation = await chatRepository.getConversation(conversationId);
    const result = await chatService.send(conversationId, text, modelOverride);
    if (result.ok && conversation !== null)
      activityRecorder.correlateRequest(result.value.requestId, {
        projectId: conversation.projectId,
        conversationId,
      });
    return result;
  });
  server.register('chat.cancel', ({ requestId }) => chatService.cancel(requestId));
  server.register('images.list', ({ projectId }) => imageService.list(projectId));
  server.register('images.delete', ({ assetId }) => imageService.delete(assetId));
  server.register('pipeline.start', async (input) => {
    const run = await pipelineOrchestrator.start(input);
    activityRecorder.correlatePipelineRun(run.id, run.projectId);
    return { ok: true, value: run };
  });
  server.register('pipeline.get', async ({ runId }) => {
    const run = await pipelineOrchestrator.get(runId);
    return run === null
      ? {
          ok: false,
          error: {
            code: ErrorCode.NOT_FOUND,
            message: 'Pipeline run was not found.',
            retryable: false,
            remediation: ['Refresh the pipeline list and select an existing run.'],
          },
        }
      : { ok: true, value: run };
  });
  server.register('pipeline.list', async (input) => ({ ok: true, value: await pipelineOrchestrator.list(input) }));
  server.register('pipeline.cancel', async ({ runId }) => {
    const run = await pipelineOrchestrator.cancel(runId);
    return run === null
      ? {
          ok: false,
          error: {
            code: ErrorCode.NOT_FOUND,
            message: 'Pipeline run was not found.',
            retryable: false,
            remediation: ['Refresh the pipeline list and select an existing run.'],
          },
        }
      : { ok: true, value: run };
  });
  server.register('workflow.graph', ({ projectId }) =>
    activityRecorder.graph(projectId).then((value) => ({ ok: true as const, value })),
  );
  server.register('workflow.activity', ({ projectId, moduleId, limit, before }) =>
    Promise.resolve({
      ok: true,
      value: activityRecorder.activity(projectId, limit, before, moduleId),
    }),
  );
  server.register('ledger.query', (query) => ledgerService.query(query));
  server.register('ledger.queryRows', (query) => ledgerService.queryRows(query));
  server.register('pnl.get', ({ projectId, from, to }) => pnlService.get(projectId, from, to));
  server.register('pnl.getAll', ({ from, to }) => pnlService.getAll(from, to));
  server.register('revenue.add', (input) => revenueService.add(input));
  server.register('revenue.list', ({ projectId, from, to }) => revenueService.list(projectId, from, to));
  server.register('revenue.listRows', ({ projectId, from, to }) => revenueService.listRows(projectId, from, to));
  server.register('budget.set', ({ projectId, period, limitMicroUsd, warnAt }) =>
    budgetGuard.set({ projectId, period, limitMicroUsd, warnAt }),
  );
  server.register('budget.setUsd', (input) => budgetGuard.setUsd(input));
  server.register('budget.status', ({ projectId }) => budgetGuard.status(projectId));
  server.register('pricing.get', () => Promise.resolve({ ok: true, value: pricingService.current() }));
  server.register('pricing.getRows', () =>
    Promise.resolve({ ok: true, value: pricingService.getRows(fxService.getEffective()) }),
  );
  server.register('pricing.override', ({ entry }) => Promise.resolve(pricingService.override(entry)));
  server.register('pricing.overrideUsd', (input) => Promise.resolve(pricingService.overrideUsd(input)));
  server.register('pricing.clearOverride', ({ modelKey }) => {
    const result = pricingService.clearOverride(modelKey);
    if (result.ok) {
      const now = isoDateTimeSchema.parse(clock.now().toISOString());
      events.publish('pricing.updated', {
        startedAt: now,
        finishedAt: now,
        status: 'applied',
        deltas: [],
        newVersion: result.value.version,
      });
    }
    return Promise.resolve(result);
  });
  server.register('pricing.refresh', () => pricingUpdater.refresh());
  server.register('rag.ingest', (input) => ragService.ingest(input));
  server.register('rag.query', (input) => ragService.query(input));
  server.register('rag.listDocuments', (input) => ragService.listDocuments(input));
  server.register('rag.deleteDocument', (input) => ragService.deleteDocument(input));

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
    pipelineOrchestrator,
    ragService,
    ledgerService,
    pnlService,
    revenueService,
    budgetGuard,
    pricingService,
    pricingUpdater,
    fxService,
    routerCompleted,
    projectService,
    vscodeBridge,
    vscodeInternalEvents,
    activityRecorder,
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
      activityRecorder.start();
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
        await vscodeLauncher.activate({
          workspaceRoot: activeProject.workspaceRoot,
          settings: settings.value.vscode,
        });
      })().catch((error: unknown) => {
        logger.error(
          { svc: 'vscode-bridge', error: error instanceof Error ? error.message : 'unknown' },
          'Could not restore active VS Code session',
        );
      });
      logger.info({ svc: 'sidecar', startupMs: Math.max(0, clock.monotonicMs() - startupStartedAt) }, 'sidecar ready');
      void (async () => {
        let recoveredTransactions = 0;
        const projects = await projectRepository.list();
        for (const project of projects) {
          const recovered = await journalRecovery.recover(project.workspaceRoot);
          if (recovered.ok) {
            recoveredTransactions += recovered.value;
            for (let index = 0; index < recovered.value; index += 1) {
              events.publish('pipeline.failureReport', {
                stage: PipelineStage.ROLLED_BACK,
                error: {
                  code: ErrorCode.INTERNAL,
                  message: 'An interrupted pipeline transaction was recovered after restart.',
                  retryable: false,
                  remediation: ['Review the restored project files, then run the pipeline again if needed.'],
                },
                rolledBack: true,
                nextSteps: ['Review the restored project files, then run the pipeline again if needed.'],
                logExcerpt: 'Recovered an interrupted workspace transaction during sidecar startup.',
              });
            }
          } else
            logger.error(
              { svc: 'journal-recovery', projectId: project.id, remediation: recovered.error.remediation },
              'Journal recovery failed',
            );
        }
        events.publish('system.ready', { version: service.getVersion(), recoveredTransactions });
      })().catch((error: unknown) => {
        logger.error(
          { svc: 'journal-recovery', error: error instanceof Error ? error.message : 'unknown' },
          'Startup recovery failed',
        );
        events.publish('system.ready', { version: service.getVersion(), recoveredTransactions: 0 });
      });
    },
  };
}
