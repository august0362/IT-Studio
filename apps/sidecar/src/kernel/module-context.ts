import type { RpcNotificationMap } from '@itstudio/schemas';
import type { Logger } from 'pino';
import type { Seeds } from './config/load-seeds.js';
import type { IClock } from './infra/clock.js';
import type { IIdGenerator } from './infra/id.js';
import type { AppDatabase } from './infra/sqlite/database.js';
import type { IFileSystem } from './ports/file-system.js';
import type { EventBus } from './rpc/event-bus.js';

/** Shared infrastructure the composition root hands to every feature module factory. */
export interface ModuleContext {
  readonly env: NodeJS.ProcessEnv;
  /** `ITSTUDIO_E2E=1`: modules use the scripted doubles the composition root passes in. */
  readonly e2e: boolean;
  /** The data directory as configured (`:memory:` in tests). */
  readonly dataDir: string;
  /** Where the app writes its own files: the data directory, or the working directory for `:memory:`. */
  readonly filesDir: string;
  readonly seeds: Seeds;
  readonly db: AppDatabase;
  readonly events: EventBus<RpcNotificationMap>;
  readonly fileSystem: IFileSystem;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: Logger;
}

/** Lets RPC handlers wait for startup recovery before touching recovered state. */
export type StartupGate = () => Promise<void>;
