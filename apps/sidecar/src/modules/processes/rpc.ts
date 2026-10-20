import type { StartupGate } from '../../kernel/module-context.js';
import type { RpcServer } from '../../kernel/rpc/rpc-server.js';
import type { ProcessesModule } from './index.js';

export function registerProcessesRpc(server: RpcServer, { registry }: ProcessesModule, ready: StartupGate): void {
  server.register('process.list', async (input) => {
    await ready();
    return registry.list(input);
  });
  server.register('process.get', async ({ id }) => {
    await ready();
    return registry.get(id);
  });
  server.register('process.cancel', async ({ id }) => {
    await ready();
    return registry.cancel(id);
  });
  server.register('process.retry', async ({ id }) => {
    await ready();
    return registry.retry(id);
  });
  server.register('process.dismiss', async ({ id }) => {
    await ready();
    return registry.dismiss(id);
  });
  server.register('process.delete', async ({ id }) => {
    await ready();
    return registry.delete(id);
  });
  server.register('process.report', async (input) => {
    await ready();
    return registry.report(input);
  });
}
