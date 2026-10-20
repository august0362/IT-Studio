import type { RpcServer } from '../../kernel/rpc/rpc-server.js';
import type { createOrchestrationModule } from './orchestration-module.js';

/** The `orch.*` handlers share the module's run state, so they live in `createOrchestrationModule.register`. */
export function registerOrchestrationRpc(
  server: RpcServer,
  orchestration: Pick<ReturnType<typeof createOrchestrationModule>, 'register'>,
): void {
  orchestration.register(server);
}
