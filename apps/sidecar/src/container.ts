import { ProcessRegistry } from './modules/processes/index.js';
import { ProcessRepository } from './kernel/infra/sqlite/process-repository.js';
import { pipelineRunIdSchema, toolCallIdSchema } from './kernel/validation/brand.js';
import { assertNever } from './kernel/domain/assert.js';
import { providerIdSchema } from './kernel/validation/common.js';
import {
  FailureKind,
  ModelCapability,
  CostPurpose,
  ImageProviderId,
  ProviderId,
  type PriceEntry,
  type OrchRunId,
  type MicroUsd,
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
import { systemClock, type IClock } from './kernel/infra/clock.js';
import { createLogger } from './kernel/infra/logger.js';
import { systemIdGenerator, type IIdGenerator } from './kernel/infra/id.js';
import { EventBus } from './kernel/rpc/event-bus.js';
import { LineTransport } from './kernel/rpc/line-transport.js';
import { RpcServer } from './kernel/rpc/rpc-server.js';
import { SystemService } from './modules/settings/index.js';
import { loadSeeds } from './kernel/config/load-seeds.js';
import { buildDefaultSettings } from './kernel/domain/default-settings.js';
import { openDatabase } from './kernel/infra/sqlite/database.js';
import { isSea, resourcePath } from './kernel/infra/native-modules.js';
import { ProjectRepository } from './kernel/infra/sqlite/project-repository.js';
import { SettingsRepository } from './kernel/infra/sqlite/settings-repository.js';
import { ChatRepository } from './kernel/infra/sqlite/chat-repository.js';
import { LedgerRepository } from './kernel/infra/sqlite/ledger-repository.js';
import { RevenueRepository } from './kernel/infra/sqlite/revenue-repository.js';
import { BudgetRepository } from './kernel/infra/sqlite/budget-repository.js';
import { PriceRepository } from './kernel/infra/sqlite/price-repository.js';
import { FxRepository } from './kernel/infra/sqlite/fx-repository.js';
import { ActivityRepository } from './kernel/infra/sqlite/activity-repository.js';
import { ActivityRecorder } from './modules/workflow/index.js';
import { ProjectService } from './modules/projects/index.js';
import { SettingsService } from './modules/settings/index.js';
import { ChatService } from './modules/chat/index.js';
import { RouterConfigService } from './modules/router/index.js';
import { UserFallbackDecider } from './modules/router/index.js';
import { KeychainSecretStore } from './kernel/infra/keychain-secret-store.js';
import { FetchHttpClient, ProviderKeyVerifier } from './kernel/infra/http/provider-key-verifier.js';
import { SecretsService } from './modules/settings/index.js';
import type { ISecretStore } from './kernel/ports/secret-store.js';
import type { IProviderKeyVerifier } from './kernel/infra/http/provider-key-verifier.js';
import { ProviderRegistry } from './kernel/providers/provider-registry.js';
import type { ILlmProvider, ProviderFailure, ProviderRequest, ProviderResponse } from './kernel/ports/llm-provider.js';
import type { ProviderId as ProviderIdType } from '@itstudio/schemas';
import { AnthropicProvider } from './kernel/providers/anthropic/anthropic-provider.js';
import { GoogleProvider } from './kernel/providers/google/google-provider.js';
import {
  OPENAI_COMPATIBLE_BASE_URLS,
  OpenAiCompatibleProvider,
} from './kernel/providers/openai-compatible/openai-compatible-provider.js';
import { ModelRegistry } from './modules/router/index.js';
import { BudgetGuard } from './modules/cost/index.js';
import { LlmRouter, type RouterCompleted } from './modules/router/index.js';
import { computeTokenCost } from './kernel/domain/cost.js';
import { LedgerService } from './modules/cost/index.js';
import { PnLService } from './modules/cost/index.js';
import { RevenueService } from './modules/cost/index.js';
import { RepositoryPriceSource } from './modules/cost/index.js';
import { FxService } from './modules/cost/index.js';
import { FxDailyJob } from './modules/cost/index.js';
import type { IHttpClient } from './kernel/ports/http-client.js';
import { PricingService } from './modules/cost/index.js';
import { PricingUpdater } from './modules/cost/index.js';
import { appendFileSync, readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { ErrorCode, type AppError, type Result } from '@itstudio/schemas';
import { z } from 'zod';
import { VSCodeBridge } from './modules/vscode/index.js';
import { VSCodeLauncher } from './modules/vscode/index.js';
import { NodeFileSystem } from './kernel/infra/node-file-system.js';
import { NodeProcessRunner } from './kernel/infra/node-process-runner.js';
import { NodeCodeCliRunner } from './kernel/infra/node-code-cli-runner.js';
import { PipelineRepository } from './kernel/infra/sqlite/pipeline-repository.js';
import { RoleCaller } from './modules/pipeline/index.js';
import { WriteTransactionService } from './modules/pipeline/index.js';
import { CommandRunner } from './modules/pipeline/index.js';
import { FailureReportBuilder } from './modules/pipeline/index.js';
import { recoverInterruptedRuns } from './modules/pipeline/index.js';
import { JournalRecoveryService } from './modules/pipeline/index.js';
import { ProjectContextService } from './modules/projects/index.js';
import { BrowserLocator } from './kernel/infra/browser-locator.js';
import { NodeBrowserLauncher } from './kernel/infra/node-browser-launcher.js';
import { WebChatService } from './modules/web-chat/index.js';
import type { IBrowserLauncher } from './kernel/ports/browser-launcher.js';
import { PipelineOrchestrator } from './modules/pipeline/index.js';
import { microUsd, toMoneyDisplay } from './kernel/domain/money.js';
import { OpenAiEmbeddingProvider } from './kernel/providers/embedding/openai.js';
import { GoogleEmbeddingProvider } from './kernel/providers/embedding/google.js';
import { FakeEmbeddingProvider } from './kernel/infra/fake-embedding-provider.js';
import { createOrchestrationModule } from './modules/orchestration/index.js';
import { OrchRepository } from './modules/orchestration/index.js';
import { OrchWorkspace } from './modules/orchestration/index.js';
import { WorktreeManager } from './modules/orchestration/index.js';
import { ApiAgentAdapter } from './modules/orchestration/index.js';
import { ClaudeCliAdapter } from './modules/orchestration/index.js';
import { CodexCliAdapter } from './modules/orchestration/index.js';
import { buildAgentPrompt, extractJsonObjects } from './modules/orchestration/index.js';
import { EmbeddingDispatcher } from './modules/knowledge/index.js';
import { LanceDbVectorStore } from './kernel/infra/lancedb/vector-store.js';
import { DocumentRepository } from './kernel/infra/sqlite/document-repository.js';
import {
  SecretHistoryRepository,
  type ISecretHistoryRepository,
} from './kernel/infra/sqlite/secret-history-repository.js';
import { RagService } from './modules/knowledge/index.js';
import { Retriever } from './modules/knowledge/index.js';
import { ImageRepository } from './kernel/infra/sqlite/image-repository.js';
import { ImageService } from './modules/images/index.js';
import { OpenAiDalle3Provider } from './kernel/providers/image/openai-dalle3.js';
import { FluxTogetherProvider } from './kernel/providers/image/flux-together.js';
import { FluxReplicateProvider } from './kernel/providers/image/flux-replicate.js';
import { FakeImageProvider } from './kernel/infra/fake-image-provider.js';
import {
  conversationIdSchema,
  isoDateTimeSchema,
  llmRequestIdSchema,
  messageIdSchema,
  projectIdSchema,
} from './kernel/validation/brand.js';
import { toolCallSchema } from './kernel/validation/chat.js';
import { jsonObjectSchema, modelKeySchema } from './kernel/validation/common.js';
import type { WorkflowInternalEvent } from './kernel/ports/workflow-internal-events.js';

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
const imageScriptSchema = z.partialRecord(
  z.enum([ImageProviderId.OPENAI_DALLE3, ImageProviderId.FLUX_TOGETHER, ImageProviderId.FLUX_REPLICATE]),
  z.array(z.string().regex(/^(success|http:\d{3})$/u)),
);

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
  capturePath?: string,
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
    if (capturePath !== undefined)
      appendFileSync(
        capturePath,
        `${JSON.stringify({ ...(request.system === undefined ? {} : { system: request.system }), messages: request.messages })}\n`,
        'utf8',
      );
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
  readonly secretHistoryRepository?: ISecretHistoryRepository;
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
  const imageScripts =
    e2e && env.ITSTUDIO_E2E_IMAGE_SCRIPT !== undefined
      ? imageScriptSchema.parse(JSON.parse(readFileSync(env.ITSTUDIO_E2E_IMAGE_SCRIPT, 'utf8')))
      : {};
  const imageScriptCursors = new Map<string, number>();
  const embeddingScriptCursors = new Map<string, number>();
  const configuredLlmText = env.ITSTUDIO_E2E_LLM_TEXT ?? 'Scripted assistant reply.';
  const llmCapturePath = e2e && env.ITSTUDIO_E2E_LLM_CAPTURE !== undefined ? env.ITSTUDIO_E2E_LLM_CAPTURE : undefined;
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
  const events = new EventBus<RpcNotificationMap>();
  const processRegistry: ProcessRegistry = new ProcessRegistry({
    repository: new ProcessRepository(database.db),
    events,
    clock,
    ids,
    logger,
    dispatch: async (operation, retryOf): Promise<Result<unknown>> => {
      switch (operation.kind) {
        case 'chat':
          return chatService.send(
            operation.params.conversationId,
            operation.params.text,
            operation.params.modelOverride,
            retryOf,
          );
        case 'code_pipeline':
          return pipelineOrchestrator.start({ ...operation.params, retryOf });
        case 'knowledge_ingest':
          return ragService.ingest({ ...operation.params, retryOf });
        case 'image':
          return imageService.generate(
            operation.params.projectId,
            operation.params.args,
            toolCallIdSchema.parse('process_' + ids.uuid()),
            new AbortController().signal,
            retryOf,
          );
        case 'price_update':
          return pricingUpdater.refresh({ ...operation.params, retryOf });
        case 'key_verify':
          return secretsService.verify(operation.params.provider, retryOf);
        default:
          return assertNever(operation);
      }
    },
    cancelRecovered: async (process): Promise<Result<unknown>> => {
      if (process.kind === 'code_pipeline' && process.ref?.type === 'pipeline_run') {
        const id = pipelineRunIdSchema.safeParse(process.ref.id);
        if (id.success) return { ok: true, value: await pipelineOrchestrator.cancel(id.data) };
      }
      if (process.kind === 'web_chat') return { ok: true, value: undefined };
      return {
        ok: false,
        error: {
          code: ErrorCode.VALIDATION,
          message: 'This operation cannot be cancelled.',
          retryable: false,
          remediation: ['Wait for the operation to finish.'],
        },
      };
    },
  });
  const migrationsDir = isSea()
    ? resourcePath('migrations')
    : resolve(dirname(fileURLToPath(import.meta.url)), 'kernel/infra/sqlite/migrations');
  const migrationsApplied = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).length;
  const projectRepository = new ProjectRepository(database.db);
  const secretHistoryRepository = dependencies.secretHistoryRepository ?? new SecretHistoryRepository(database.db);
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
  const secretStore = dependencies.secretStore ?? (e2e ? new MemorySecretStore() : new KeychainSecretStore());
  const qwenVerificationModel = loadedSeeds.value.pricing.entries
    .filter((entry) =>
      loadedSeeds.value.models.some(
        (model) => model.key === entry.modelKey && model.provider === ProviderId.QWEN && model.enabled,
      ),
    )
    .toSorted(
      (a, b) => a.inputPerMTokMicroUsd + a.outputPerMTokMicroUsd - (b.inputPerMTokMicroUsd + b.outputPerMTokMicroUsd),
    )[0];
  const qwenVerificationModelId = loadedSeeds.value.models.find(
    (model) => model.key === qwenVerificationModel?.modelKey,
  )?.providerModelId;
  const secretsService = new SecretsService({
    processes: processRegistry,
    store: secretStore,
    history: secretHistoryRepository,
    ids,
    verifier:
      dependencies.keyVerifier ??
      (e2e
        ? new ScriptedKeyVerifier(env.ITSTUDIO_E2E_VERIFIER_OUTCOME, env.ITSTUDIO_E2E_VERIFIER_FIXTURE)
        : new ProviderKeyVerifier(new FetchHttpClient(), () => settingsService.get(), qwenVerificationModelId)),
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
  const compatibleFactories = Object.fromEntries(
    Object.entries(OPENAI_COMPATIBLE_BASE_URLS).map(([id, baseURL]) => {
      const providerId = providerIdSchema.parse(id);
      return [
        providerId,
        () =>
          e2e
            ? scriptedLlmProvider(providerId, llmTexts, llmScripts, llmScriptCursors, llmCapturePath)
            : new OpenAiCompatibleProvider({
                id: providerId,
                baseURL:
                  providerId === ProviderId.QWEN
                    ? async () => {
                        const settings = await settingsService.get();
                        if (!settings.ok) throw new Error('Could not load provider settings.');
                        return settings.value.providers?.qwen?.baseUrl ?? baseURL;
                      }
                    : baseURL,
              }),
      ];
    }),
  );
  const providers = new ProviderRegistry({
    ...compatibleFactories,
    [ProviderId.ANTHROPIC]: () =>
      e2e
        ? scriptedLlmProvider(ProviderId.ANTHROPIC, llmTexts, llmScripts, llmScriptCursors, llmCapturePath)
        : new AnthropicProvider(),
    [ProviderId.GOOGLE]: () =>
      e2e
        ? scriptedLlmProvider(ProviderId.GOOGLE, llmTexts, llmScripts, llmScriptCursors, llmCapturePath)
        : new GoogleProvider(),
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
  if (e2e && env.ITSTUDIO_E2E_IMAGE_PRICE_MICRO_USD !== undefined) {
    const perImageMicroUsd = Number(env.ITSTUDIO_E2E_IMAGE_PRICE_MICRO_USD);
    if (!Number.isSafeInteger(perImageMicroUsd) || perImageMicroUsd < 0)
      throw new Error('ITSTUDIO_E2E_IMAGE_PRICE_MICRO_USD must be a non-negative safe integer.');
    const imagePrice: PriceEntry = {
      modelKey: modelKeySchema.parse('openai/image-generation'),
      inputPerMTokMicroUsd: microUsd(0),
      outputPerMTokMicroUsd: microUsd(0),
      cachedInputPerMTokMicroUsd: microUsd(0),
      perImageMicroUsd: microUsd(perImageMicroUsd),
      freeTier: false,
      sourceUrl: 'https://example.invalid/e2e-image-price',
    };
    pricingService.applyExtracted([imagePrice]);
  }
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
  const workflowInternalBus = new EventBus<{ activity: WorkflowInternalEvent }>();
  const workflowInternalEvents = {
    publish: (event: WorkflowInternalEvent) => {
      workflowInternalBus.publish('activity', event);
    },
    subscribe: (handler: (event: WorkflowInternalEvent) => void) => workflowInternalBus.subscribe('activity', handler),
  };
  const activityRecorder = new ActivityRecorder({
    logger,
    events,
    repository: activityRepository,
    ids,
    clock,
    settings: settingsService,
    aggregateCost: (amount) => toMoneyDisplay(microUsd(amount), fxService.getEffective()),
    vscodeBridgeAvailable: vscodeBridgeEnabled,
    internalEvents: workflowInternalEvents,
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
      windowClosed: (_projectId, root, reason) => {
        vscodeLauncher.windowClosed(root, reason);
      },
      windowDisconnected: (root) => {
        vscodeLauncher.windowDisconnected(root);
      },
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
      publishActivity: (value) => {
        workflowInternalEvents.publish(value);
      },
    },
  });
  const vscodeLauncher = new VSCodeLauncher({
    clock,
    onLaunched: (projectId, root, launchedAt) => {
      vscodeBridge.recordLaunch(projectId, root, launchedAt);
    },
    processes: processRegistry,
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
    ? [
        new FakeImageProvider(ImageProviderId.OPENAI_DALLE3, imageScripts, imageScriptCursors),
        new FakeImageProvider(ImageProviderId.FLUX_TOGETHER, imageScripts, imageScriptCursors),
        new FakeImageProvider(ImageProviderId.FLUX_REPLICATE, imageScripts, imageScriptCursors),
      ]
    : [
        new OpenAiDalle3Provider(secretStore),
        new FluxTogetherProvider(secretStore, new FetchHttpClient()),
        new FluxReplicateProvider(secretStore, new FetchHttpClient()),
      ];
  const imageService = new ImageService({
    processes: processRegistry,
    costText: (amount) => {
      const cost = toMoneyDisplay(amount, fxService.getEffective());
      return cost.usdText + '\n' + cost.vndText;
    },
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
    internalEvents: workflowInternalEvents,
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
        internalEvents: workflowInternalEvents,
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
    internalEvents: workflowInternalEvents,
  });
  const ragService = new RagService({
    processes: processRegistry,
    costText: (amount) => {
      const cost = toMoneyDisplay(amount, fxService.getEffective());
      return cost.usdText + '\n' + cost.vndText;
    },
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
    processes: processRegistry,
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
    processes: processRegistry,
    costText: (amount) => {
      const cost = toMoneyDisplay(amount, fxService.getEffective());
      return cost.usdText + '\n' + cost.vndText;
    },
    settings: settingsService,
    secretStore,
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
  let startupRecovery: Promise<void> = Promise.resolve();
  const pipelineRepository = new PipelineRepository(database.db);
  const roleCaller = new RoleCaller({ router: llmRouter, logger, ids, now: () => clock.now() });
  const writeTransaction = new WriteTransactionService({ fileSystem, ids, clock });
  const workerProcessRunner = new NodeProcessRunner();
  const commandRunner = new CommandRunner({
    processRunner: workerProcessRunner,
    fileSystem,
    ids,
    internalEvents: workflowInternalEvents,
  });
  const journalRecovery = new JournalRecoveryService(fileSystem, clock, logger);
  const projectContext = new ProjectContextService(fileSystem);
  const browserLocator = new BrowserLocator(fileSystem, env);
  const browserLaunches: { readonly executable: string; readonly args: readonly string[] }[] = [];
  const browserLauncher: IBrowserLauncher = e2e
    ? {
        launch: (executable, url) => {
          const record = { executable, args: [url] } as const;
          browserLaunches.push(record);
          let safeUrl = url;
          try {
            const parsedUrl = new URL(url);
            parsedUrl.search = '';
            parsedUrl.hash = '';
            safeUrl = parsedUrl.toString();
          } catch {
            // The launcher validates URLs before the E2E recorder receives them.
          }
          logger.info({ svc: 'webchat-e2e', executable, args: [safeUrl] }, 'Recorded browser launch request');
          return { ok: true, value: undefined };
        },
      }
    : new NodeBrowserLauncher(logger);
  const webChatService = new WebChatService({
    settings: settingsService,
    projects: projectRepository,
    context: projectContext,
    launcher: browserLauncher,
    locator: browserLocator,
    fileSystem,
    env,
    logger,
  });
  const failureReportBuilder = new FailureReportBuilder();
  const pipelineOrchestrator = new PipelineOrchestrator({
    processes: processRegistry,
    eligibility: {
      load: async () => {
        const configuredProviders: ProviderId[] = [];
        for (const provider of new Set(modelRegistry.list().map((model) => model.provider))) {
          const stored = await secretStore.get(provider);
          if (!stored.ok) return stored;
          if (stored.value !== null) configuredProviders.push(provider);
        }
        return {
          ok: true,
          value: {
            models: modelRegistry.list(),
            configuredProviders,
            eligibleModelKeys: modelRegistry
              .list()
              .filter(
                (model) =>
                  modelRegistry.eligibility(model.key, [ModelCapability.CHAT, ModelCapability.JSON_MODE], (provider) =>
                    configuredProviders.includes(provider),
                  ).eligible,
              )
              .map((model) => model.key),
          },
        };
      },
    },
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
  const projectService = new ProjectService({
    repository: projectRepository,
    settings: settingsService,
    ids,
    clock,
    fileSystem,
    vectors: vectorStore,
    dataDir: dataDir === ':memory:' ? resolve('.') : dataDir,
    logger,
    pipelineBusy: (projectId) => pipelineOrchestrator.isBusy(projectId),
    forgetActivity: async (projectId) => {
      pipelineOrchestrator.forgetProject(projectId);
      await activityRecorder.forgetProject(projectId);
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
  const orchProcessRunner = new NodeProcessRunner();
  // Orchestration must never target IT Studio itself: the install folder when packaged, the source
  // repository in development (the dev shell starts the sidecar there). A packaged app's cwd is arbitrary.
  const itStudioRoot = isSea() ? dirname(process.execPath) : process.cwd();
  const orchestration = createOrchestrationModule({
    repository: new OrchRepository(database.db),
    processes: processRegistry,
    workspace: new OrchWorkspace({
      projects: projectRepository,
      worktrees: new WorktreeManager(workerProcessRunner),
      apply: { runner: workerProcessRunner, fileSystem, commands: commandRunner, writer: writeTransaction },
      runner: workerProcessRunner,
      sidecarCwd: itStudioRoot,
      appExecutableDir: dirname(process.execPath),
    }),
    adapters: [
      new ApiAgentAdapter(async ({ envelope, input, signal }) => {
        const modelKey = modelKeySchema.safeParse(
          envelope.modelId.startsWith(`${envelope.providerId}/`)
            ? envelope.modelId
            : `${envelope.providerId}/${envelope.modelId}`,
        );
        const requestId = llmRequestIdSchema.parse(ids.uuid());
        const response = await llmRouter.dispatch(
          {
            id: requestId,
            projectId: projectIdSchema.parse(envelope.projectId),
            purpose:
              envelope.roleId === 'worker'
                ? CostPurpose.PIPELINE_CODER
                : envelope.roleId === 'reviewer'
                  ? CostPurpose.PIPELINE_REVIEWER
                  : CostPurpose.PIPELINE_PM,
            messages: [
              {
                id: messageIdSchema.parse(ids.uuid()),
                conversationId: conversationIdSchema.parse(ids.uuid()),
                role: 'user',
                createdAt: isoDateTimeSchema.parse(clock.now().toISOString()),
                parts: [{ type: 'text', text: buildAgentPrompt(envelope, input, { withAck: false }) }],
              },
            ],
            systemPrompt: `You are the ${envelope.roleId} agent of an IT Studio orchestration run. Follow the user message exactly and return one JSON object.`,
            requiredCapabilities: [ModelCapability.CHAT, ModelCapability.JSON_MODE],
            responseFormat: 'json',
            ...(envelope.modelId === 'mock' || !modelKey.success ? {} : { preferredModelKey: modelKey.data }),
            maxOutputTokens: envelope.roleId === 'worker' ? 16_384 : 8_192,
            stream: false,
          },
          { signal },
        );
        if (!response.ok) return response;
        const text = response.value.message.parts.find((part) => part.type === 'text');
        const payload = text === undefined ? undefined : extractJsonObjects(text.text)[0];
        // The router reports 0; the real cost is priced by the ledger. Unknown stays null, never 0.
        const recorded = await ledgerService.recordedCost(requestId);
        return payload === undefined
          ? {
              ok: false as const,
              error: { code: ErrorCode.VALIDATION, message: 'Agent returned no JSON object.', retryable: false },
            }
          : {
              ok: true as const,
              value: {
                payload,
                usage: {
                  inputTokens: response.value.usage.inputTokens,
                  outputTokens: response.value.usage.outputTokens,
                  cachedInputTokens: response.value.usage.cachedInputTokens,
                  reasoningTokens: null,
                  source: 'provider' as const,
                  costMicroUsd: recorded?.microUsd ?? null,
                  billing: 'api' as const,
                },
              },
            };
      }),
      new ClaudeCliAdapter(orchProcessRunner),
      new CodexCliAdapter(orchProcessRunner),
    ],
    includeMock: env.ITSTUDIO_E2E_ORCH_MOCK === '1' || process.env.NODE_ENV === 'test',
    ...(env.ITSTUDIO_E2E_ORCH_MOCK === '1'
      ? {
          scripts: {
            worker: () =>
              Promise.resolve({
                summary: 'Create the orchestration E2E fixture file.',
                operations: [
                  {
                    kind: 'create',
                    path: 'src/orchestration-e2e.ts',
                    content: 'export const orchestrationE2e = true;\n',
                  },
                ],
                assumptions: [],
              }),
          },
        }
      : {}),
    validate: { workspaceRoot: dataDir, allowedCommands: [] },
    runner: workerProcessRunner,
    projects: projectRepository,
    sidecarCwd: itStudioRoot,
    appExecutableDir: dirname(process.execPath),
    settings: async () => {
      const settings = await settingsService.get();
      return settings.ok
        ? {
            ok: true as const,
            value: {
              orchestration: settings.value.orchestration,
              allowedCommands: settings.value.pipeline.validationCommands,
            },
          }
        : settings;
    },
    createRun: (projectId, request, specs, options) => {
      const now = isoDateTimeSchema.parse(clock.now().toISOString());
      return {
        id: (options?.id ?? ids.uuid()) as OrchRunId,
        projectId,
        request,
        state: 'plan_ready',
        agents: options?.agents ?? [
          { agentId: 'mock-supervisor', role: 'supervisor', transport: 'mock' },
          { agentId: 'mock-worker', role: 'worker', transport: 'mock' },
          { agentId: 'mock-reviewer', role: 'reviewer', transport: 'mock' },
        ],
        tasks: specs.map((spec) => ({ ...spec, state: 'ready' as const, fixRounds: 0, attempts: [] })),
        limits: options?.limits ?? {
          maxCostMicroUsd: 2_000_000 as MicroUsd,
          maxWallClockMs: 3_600_000,
          maxAgentCalls: 40,
          maxConcurrentWorkers: 2,
          maxFixRounds: 2,
          transientRetries: 1,
          hardStop: false,
        },
        targetBranch: options?.targetBranch ?? 'main',
        costMicroUsd: 0 as MicroUsd,
        agentCalls: 0,
        createdAt: now,
        updatedAt: now,
      };
    },
    publish: (event) => {
      events.publish('orch.event', event);
    },
  });
  orchestration.register(server);
  let fxJobStopped = false;
  const service = new SystemService({
    clock,
    startedAt: clock.monotonicMs(),
    logger,
    shutdownHooks: [
      async () => {
        fxJobStopped = true;
        const settings = await settingsService.get();
        if (settings.ok) await vscodeBridge.closeWindows(settings.value.vscode, 'studio_exit');
        await vscodeBridge.stop();
        processRegistry.stop();
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
  server.register('process.list', async (input) => {
    await startupRecovery;
    return processRegistry.list(input);
  });
  server.register('process.get', async ({ id }) => {
    await startupRecovery;
    return processRegistry.get(id);
  });
  server.register('process.cancel', async ({ id }) => {
    await startupRecovery;
    return processRegistry.cancel(id);
  });
  server.register('process.retry', async ({ id }) => {
    await startupRecovery;
    return processRegistry.retry(id);
  });
  server.register('process.dismiss', async ({ id }) => {
    await startupRecovery;
    return processRegistry.dismiss(id);
  });
  server.register('process.delete', async ({ id }) => {
    await startupRecovery;
    return processRegistry.delete(id);
  });
  server.register('process.report', async (input) => {
    await startupRecovery;
    return processRegistry.report(input);
  });
  server.register('settings.get', () => settingsService.get());
  server.register('settings.update', ({ patch }) => settingsService.update(patch));
  server.register('webchat.browsers', () => webChatService.browsers());
  server.register('webchat.open', ({ linkId }) => webChatService.open(linkId));
  server.register('webchat.projectBrief', ({ projectId }) => webChatService.projectBrief(projectId));
  server.register('fx.get', () => fxService.get());
  server.register('fx.override', ({ usdToVnd }) => fxService.override(usdToVnd));
  server.register('router.getConfig', () => routerConfigService.getConfig());
  server.register('router.updateConfig', ({ config }) => routerConfigService.updateConfig(config));
  server.register('router.resolveFallback', (decision) =>
    Promise.resolve({ ok: true, value: fallbackDecider.resolve(decision) }),
  );
  server.register('project.list', () => projectService.list());
  server.register('vscode.closeForProject', async ({ projectId, reason }) => {
    const settings = await settingsService.get();
    if (!settings.ok) return settings;
    void vscodeBridge.closeWindows(settings.value.vscode, reason, projectId);
    return { ok: true, value: { accepted: true } };
  });
  server.register('project.delete', async ({ projectId }) => {
    await startupRecovery;
    const result = await projectService.delete(projectId);
    if (result.ok) {
      const settings = await settingsService.get();
      if (settings.ok) void vscodeBridge.closeWindows(settings.value.vscode, 'project_deleted', projectId);
    }
    return result;
  });
  server.register('project.create', ({ name, workspaceRoot }) => projectService.create(name, workspaceRoot));
  server.register('project.setActive', async ({ projectId }) => {
    const result = await projectService.setActive(projectId);
    if (result.ok && vscodeBridgeEnabled) {
      try {
        await vscodeBridge.activate(result.value.id, result.value.workspaceRoot);
        const settings = await settingsService.get();
        if (settings.ok)
          await vscodeLauncher.activate({
            projectId: result.value.id,
            workspaceRoot: result.value.workspaceRoot,
            settings: settings.value.vscode,
          });
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
  server.register('secrets.verifyAndSave', ({ provider, apiKey }) => secretsService.verifyAndSave(provider, apiKey));
  server.register('secrets.history', ({ provider, limit }) => Promise.resolve(secretsService.history(provider, limit)));
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
    await startupRecovery;
    if (projectService.isDeleting(input.projectId))
      return {
        ok: false,
        error: {
          code: ErrorCode.CONFLICT,
          message: 'Project deletion is in progress.',
          retryable: false,
          remediation: ['Wait for project deletion to finish.'],
        },
      };
    const result = await pipelineOrchestrator.start(input);
    if (result.ok) activityRecorder.correlatePipelineRun(result.value.id, result.value.projectId);
    return result;
  });
  server.register('pipeline.get', async ({ runId }) => {
    await startupRecovery;
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
  server.register('pipeline.list', async (input) => {
    await startupRecovery;
    return { ok: true, value: await pipelineOrchestrator.list(input) };
  });
  server.register('pipeline.cancel', async ({ runId }) => {
    await startupRecovery;
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
  server.register('pipeline.answerClarifications', async (input) => {
    await startupRecovery;
    return pipelineOrchestrator.answerClarifications(input);
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
  server.register('pricing.getRows', async () => {
    const fx = fxService.getEffective();
    const extraction = await pricingUpdater.extractionOptions(fx);
    if (!extraction.ok) return extraction;
    return { ok: true, value: { ...pricingService.getRows(fx), extraction: extraction.value } };
  });
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
    browserLaunches,
    webChatService,
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
    processRegistry,
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
          projectId: activeProject.id,
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
      startupRecovery = (async () => {
        await processRegistry.recover(async (process) => {
          const id = pipelineRunIdSchema.safeParse(process.ref?.id);
          return id.success && (await pipelineRepository.get(id.data))?.stage === 'clarifying';
        });
        let recoveredTransactions = 0;
        const projects = await projectRepository.list();
        for (const project of projects) {
          const recoveredIds = new Set<string>();
          const recovered = await journalRecovery.recover(project.workspaceRoot, (id) => recoveredIds.add(id));
          if (recovered.ok) {
            recoveredTransactions += recovered.value;
          } else
            logger.error(
              { svc: 'journal-recovery', projectId: project.id, remediation: recovered.error.remediation },
              'Journal recovery failed',
            );
          await recoverInterruptedRuns({
            projectId: project.id,
            recoveredTransactions: recoveredIds,
            repository: pipelineRepository,
            reports: failureReportBuilder,
            events,
            clock,
          });
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
