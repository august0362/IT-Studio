import type { RpcServer } from '../../kernel/rpc/rpc-server.js';
import type { SettingsModule } from './index.js';

export function registerSettingsRpc(server: RpcServer, { settings, secrets }: SettingsModule): void {
  server.register('settings.get', () => settings.get());
  server.register('settings.update', ({ patch }) => settings.update(patch));
  server.register('secrets.set', ({ provider, apiKey }) => secrets.set(provider, apiKey));
  server.register('secrets.delete', ({ provider }) => secrets.delete(provider));
  server.register('secrets.status', () => secrets.status());
  server.register('secrets.verify', ({ provider }) => secrets.verify(provider));
  server.register('secrets.verifyAndSave', ({ provider, apiKey }) => secrets.verifyAndSave(provider, apiKey));
  server.register('secrets.history', ({ provider, limit }) => Promise.resolve(secrets.history(provider, limit)));
}
