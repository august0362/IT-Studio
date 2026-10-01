import type { RpcNotificationMap } from '@itstudio/schemas';
import { stdin, stdout } from 'node:process';
import type { Readable, Writable } from 'node:stream';
import type { Logger } from 'pino';
import { systemClock, type IClock } from './infra/clock.js';
import { createLogger } from './infra/logger.js';
import { systemIdGenerator, type IIdGenerator } from './infra/id.js';
import { EventBus } from './rpc/event-bus.js';
import { LineTransport } from './rpc/line-transport.js';
import { RpcServer } from './rpc/rpc-server.js';
import { SystemService } from './services/system-service.js';

export interface ContainerDependencies {
  readonly input?: Readable;
  readonly output?: Writable;
  readonly clock?: IClock;
  readonly ids?: IIdGenerator;
  readonly logger?: Logger;
  readonly exit?: (code: number) => void;
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

  return {
    clock,
    ids,
    events,
    logger,
    server,
    start(): void {
      transport.start();
      events.publish('system.ready', { version: service.getVersion(), recoveredTransactions: 0 });
    },
  };
}
