import type { RpcNotificationMap } from '@itstudio/schemas';
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

export interface ContainerDependencies {
  readonly input?: Readable;
  readonly output?: Writable;
  readonly clock?: IClock;
  readonly ids?: IIdGenerator;
  readonly logger?: Logger;
  readonly exit?: (code: number) => void;
  readonly dataDir?: string;
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

  return {
    clock,
    ids,
    database,
    settingsService,
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
