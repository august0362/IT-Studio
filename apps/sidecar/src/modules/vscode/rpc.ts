import type { RpcServer } from '../../kernel/rpc/rpc-server.js';
import type { SettingsService } from '../settings/index.js';
import type { VscodeModule } from './index.js';

export function registerVscodeRpc(server: RpcServer, { bridge }: VscodeModule, settingsService: SettingsService): void {
  server.register('vscode.closeForProject', async ({ projectId, reason }) => {
    const settings = await settingsService.get();
    if (!settings.ok) return settings;
    void bridge.closeWindows(settings.value.vscode, reason, projectId);
    return { ok: true, value: { accepted: true } };
  });
}
