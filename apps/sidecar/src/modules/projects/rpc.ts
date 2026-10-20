import type { StartupGate } from '../../kernel/module-context.js';
import type { RpcServer } from '../../kernel/rpc/rpc-server.js';
import type { SettingsService } from '../settings/index.js';
import type { VscodeModule } from '../vscode/index.js';
import type { ProjectsModule } from './index.js';

export interface ProjectsRpcDependencies {
  readonly settings: SettingsService;
  readonly vscode: VscodeModule;
  readonly ready: StartupGate;
  readonly logger: { error(fields: object, message: string): void };
}

export function registerProjectsRpc(
  server: RpcServer,
  { service }: ProjectsModule,
  deps: ProjectsRpcDependencies,
): void {
  const { settings: settingsService, vscode, logger } = deps;
  server.register('project.list', () => service.list());
  server.register('project.delete', async ({ projectId }) => {
    await deps.ready();
    const result = await service.delete(projectId);
    if (result.ok) {
      const settings = await settingsService.get();
      if (settings.ok) void vscode.bridge.closeWindows(settings.value.vscode, 'project_deleted', projectId);
    }
    return result;
  });
  server.register('project.create', ({ name, workspaceRoot }) => service.create(name, workspaceRoot));
  server.register('project.setActive', async ({ projectId }) => {
    const result = await service.setActive(projectId);
    if (result.ok && vscode.enabled) {
      try {
        await vscode.bridge.activate(result.value.id, result.value.workspaceRoot);
        const settings = await settingsService.get();
        if (settings.ok)
          await vscode.launcher.activate({
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
}
