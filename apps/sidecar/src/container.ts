import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { RpcNotificationMap } from '@itstudio/schemas';
import type { Logger } from 'pino';
import { createE2eDoubles } from './e2e-doubles.js';
import { loadSeeds } from './kernel/config/load-seeds.js';
import { systemClock, type IClock } from './kernel/infra/clock.js';
import type { IProviderKeyVerifier } from './kernel/infra/http/provider-key-verifier.js';
import { systemIdGenerator, type IIdGenerator } from './kernel/infra/id.js';
import { createLogger } from './kernel/infra/logger.js';
import { isSea, resourcePath } from './kernel/infra/native-modules.js';
import { NodeFileSystem } from './kernel/infra/node-file-system.js';
import { openDatabase } from './kernel/infra/sqlite/database.js';
import type { ISecretHistoryRepository } from './kernel/infra/sqlite/secret-history-repository.js';
import type { ModuleContext } from './kernel/module-context.js';
import type { IHttpClient } from './kernel/ports/http-client.js';
import type { ISecretStore } from './kernel/ports/secret-store.js';
import { EventBus } from './kernel/rpc/event-bus.js';
import { LineTransport } from './kernel/rpc/line-transport.js';
import { RpcServer } from './kernel/rpc/rpc-server.js';
import { createChatModule, registerChatRpc } from './modules/chat/index.js';
import { createCostModule, createPricingUpdater, registerCostRpc } from './modules/cost/index.js';
import { createImagesModule, registerImagesRpc } from './modules/images/index.js';
import { createKnowledgeModule, registerKnowledgeRpc } from './modules/knowledge/index.js';
import { createOrchestration, registerOrchestrationRpc } from './modules/orchestration/index.js';
import { createPipelineModule, registerPipelineRpc } from './modules/pipeline/index.js';
import { createProcessesModule, registerProcessesRpc } from './modules/processes/index.js';
import { createProjectsModule, registerProjectsRpc } from './modules/projects/index.js';
import { createModelCatalog, createRouterModule, registerRouterRpc } from './modules/router/index.js';
import { createSettingsModule, registerSettingsRpc, SystemService } from './modules/settings/index.js';
import { createVscodeModule, registerVscodeRpc } from './modules/vscode/index.js';
import { createWebChatModule, registerWebChatRpc } from './modules/web-chat/index.js';
import { createWorkflowModule, registerWorkflowRpc } from './modules/workflow/index.js';

export { scriptedLlmProvider } from './e2e-doubles.js';

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

/** Composition root: builds kernel infrastructure, then each feature module in dependency order. */
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
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const doubles = e2e ? createE2eDoubles(env, sourceDir) : undefined;
  const repositoryRoot = resolve(sourceDir, '../../..');
  const loadedSeeds = loadSeeds(resolve(repositoryRoot, 'config'));
  if (!loadedSeeds.ok) throw new Error(loadedSeeds.error.message);
  const seeds = loadedSeeds.value;
  for (const warning of seeds.warnings) logger.warn({ svc: 'sidecar', warning }, 'Seed configuration warning');
  const database = openDatabase(dataDir);
  const events = new EventBus<RpcNotificationMap>();
  const ctx: ModuleContext = {
    env,
    e2e,
    dataDir,
    filesDir: dataDir === ':memory:' ? resolve('.') : dataDir,
    seeds,
    db: database.db,
    events,
    fileSystem: new NodeFileSystem(),
    clock,
    ids,
    logger,
  };
  // Retries are dispatched to modules built further down; the handlers only run after construction.
  const processes = createProcessesModule(ctx, {
    handlers: {
      chat: (params, retryOf) => chat.service.send(params.conversationId, params.text, params.modelOverride, retryOf),
      code_pipeline: (params, retryOf) => pipeline.orchestrator.start({ ...params, retryOf }),
      knowledge_ingest: (params, retryOf) => knowledge.rag.ingest({ ...params, retryOf }),
      image: (params, retryOf) => images.retry(params, retryOf),
      price_update: (params, retryOf) => pricingUpdater.refresh({ ...params, retryOf }),
      key_verify: (params, retryOf) => settings.secrets.verify(params.provider, retryOf),
    },
    cancelPipeline: (id) => pipeline.orchestrator.cancel(id),
  });
  const migrationsDir = isSea() ? resourcePath('migrations') : resolve(sourceDir, 'kernel/infra/sqlite/migrations');
  const migrationsApplied = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).length;
  const registry = processes.registry;
  const settings = createSettingsModule(ctx, {
    processes: registry,
    secretStore: dependencies.secretStore ?? doubles?.secretStore,
    secretHistory: dependencies.secretHistoryRepository,
    keyVerifier: dependencies.keyVerifier ?? doubles?.keyVerifier(),
  });
  const { settings: settingsService, secretStore } = settings;
  const catalog = createModelCatalog(ctx, { settings: settingsService, scriptedProvider: doubles?.llmProvider });
  const cost = createCostModule(ctx, {
    settings: settingsService,
    catalog,
    fxHttp: dependencies.fxHttpClient ?? doubles?.fxHttp(seeds.fx.seedUsdToVnd),
  });
  const vscodeEnabled = dataDir !== ':memory:' || e2e;
  const workflow = createWorkflowModule(ctx, { settings: settingsService, cost, vscodeBridgeAvailable: vscodeEnabled });
  const { internalEvents } = workflow;
  const shared = { processes: registry, settings: settingsService, secretStore, cost, internalEvents };
  const vscode = createVscodeModule(ctx, { ...shared, enabled: vscodeEnabled, repositoryRoot });
  const images = createImagesModule(ctx, { ...shared, providers: doubles?.imageProviders });
  const knowledge = createKnowledgeModule(ctx, { ...shared, catalog, embeddingProvider: doubles?.embeddingProvider });
  const router = createRouterModule(ctx, { catalog, settings: settingsService, secretStore, cost });
  const chat = createChatModule(ctx, { ...shared, router, knowledge, images });
  const pricingUpdater = createPricingUpdater(ctx, {
    ...shared,
    catalog,
    router: router.router,
    http: dependencies.pricingHttpClient ?? doubles?.pricingHttp,
  });
  const projects = createProjectsModule(ctx, {
    settings: settingsService,
    vectors: knowledge.vectors,
    pipelineBusy: (projectId) => pipeline.orchestrator.isBusy(projectId),
    forgetActivity: async (projectId) => {
      pipeline.orchestrator.forgetProject(projectId);
      await workflow.recorder.forgetProject(projectId);
    },
  });
  const webChat = createWebChatModule(ctx, {
    settings: settingsService,
    projects,
    launcher: doubles?.browserLauncher(logger),
  });
  const pipeline = createPipelineModule(ctx, { ...shared, router, projects });
  let startupRecovery: Promise<void> = Promise.resolve();
  const ready = () => startupRecovery;
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
  const orchestration = createOrchestration(ctx, { ...shared, router, pipeline, projects });
  registerOrchestrationRpc(server, orchestration);
  const service = new SystemService({
    clock,
    startedAt: clock.monotonicMs(),
    logger,
    shutdownHooks: [
      async () => {
        cost.beginShutdown();
        await vscode.stop();
        registry.stop();
      },
      () => {
        cost.stop();
      },
      () => {
        workflow.recorder.stop();
      },
    ],
    ...(dependencies.exit === undefined ? {} : { exit: dependencies.exit }),
  });
  systemServiceRef.current = service;
  service.register(server);
  registerProcessesRpc(server, processes, ready);
  registerSettingsRpc(server, settings);
  registerWebChatRpc(server, webChat);
  registerRouterRpc(server, router);
  registerVscodeRpc(server, vscode, settingsService);
  registerProjectsRpc(server, projects, { settings: settingsService, vscode, ready, logger });
  registerChatRpc(server, chat, workflow);
  registerImagesRpc(server, images);
  registerPipelineRpc(server, pipeline, { projects, workflow, ready });
  registerWorkflowRpc(server, workflow);
  registerCostRpc(server, cost, pricingUpdater);
  registerKnowledgeRpc(server, knowledge);

  return {
    clock,
    ids,
    database,
    events,
    logger,
    server,
    settingsService,
    secretsService: settings.secrets,
    providers: catalog.providers,
    modelRegistry: catalog.models,
    chatService: chat.service,
    pipelineOrchestrator: pipeline.orchestrator,
    projectService: projects.service,
    processRegistry: registry,
    start(): void {
      logger.info(
        { svc: 'sidecar', version: service.getVersion(), nodeVersion: process.version, dataDir },
        'sidecar starting',
      );
      logger.info({ svc: 'sidecar', count: migrationsApplied }, 'migrations applied');
      logger.info(
        { svc: 'sidecar', models: seeds.models.length, warningsCount: seeds.warnings.length },
        'seeds loaded',
      );
      transport.start();
      workflow.recorder.start();
      cost.start();
      vscode.restoreActiveSession(() => projects.service.list());
      logger.info({ svc: 'sidecar', startupMs: Math.max(0, clock.monotonicMs() - startupStartedAt) }, 'sidecar ready');
      startupRecovery = (async () => {
        await registry.recover((process) => pipeline.isClarifying(process));
        await pipeline.recoverWorkspaces((recoveredTransactions) => {
          events.publish('system.ready', { version: service.getVersion(), recoveredTransactions });
        });
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
