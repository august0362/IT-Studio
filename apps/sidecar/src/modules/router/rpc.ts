import type { RpcServer } from '../../kernel/rpc/rpc-server.js';
import type { RouterModule } from './index.js';

export function registerRouterRpc(server: RpcServer, { config, fallbackDecider, models }: RouterModule): void {
  server.register('router.getConfig', () => config.getConfig());
  server.register('router.updateConfig', ({ config: next }) => config.updateConfig(next));
  server.register('router.resolveFallback', (decision) =>
    Promise.resolve({ ok: true, value: fallbackDecider.resolve(decision) }),
  );
  server.register('models.list', () => Promise.resolve({ ok: true, value: models.list() }));
}
