import type { Project, ProjectId, Result, VSCodeStatus, WorkspaceRelativePath } from '@itstudio/schemas';
import { NodeCodeCliRunner } from '../../kernel/infra/node-code-cli-runner.js';
import type { ModuleContext } from '../../kernel/module-context.js';
import type { IProcessTracker } from '../../kernel/ports/process-tracker.js';
import type { WorkflowInternalEventBus } from '../../kernel/ports/workflow-internal-events.js';
import { EventBus } from '../../kernel/rpc/event-bus.js';
import type { SettingsService } from '../settings/index.js';
import { VSCodeBridge } from './services/vscode-bridge.js';
import { VSCodeLauncher } from './services/vscode-launcher.js';

export interface VscodeModuleDependencies {
  readonly processes: IProcessTracker;
  readonly settings: SettingsService;
  readonly internalEvents: WorkflowInternalEventBus;
  /** The bridge serves real data directories, and E2E runs even with `:memory:`. */
  readonly enabled: boolean;
  /** IT Studio's own source/install root, where the bundled VS Code extension is found. */
  readonly repositoryRoot: string;
}

export function createVscodeModule(ctx: ModuleContext, deps: VscodeModuleDependencies) {
  const { events, logger } = ctx;
  const { settings } = deps;
  let vscodeConnected = false;
  let vscodeStatus: VSCodeStatus = {
    installed: false,
    extensionInstalled: false,
    connected: false,
  };
  const internalEvents = new EventBus<{
    file_saved_by_user: { readonly projectId: ProjectId; readonly path: WorkspaceRelativePath; readonly hash: string };
  }>();
  const bridge = new VSCodeBridge({
    ids: ctx.ids,
    logger,
    events: {
      windowClosed: (_projectId, root, reason) => {
        launcher.windowClosed(root, reason);
      },
      windowDisconnected: (root) => {
        launcher.windowDisconnected(root);
      },
      publishStatus: (value) => {
        vscodeConnected = value.connected;
        vscodeStatus = {
          ...vscodeStatus,
          connected: value.connected,
          ...(value.workspaceRoot === undefined ? {} : { workspaceRoot: value.workspaceRoot }),
          ...(value.extensionVersion === undefined ? {} : { extensionVersion: value.extensionVersion }),
        };
        events.publish('vscode.status', vscodeStatus);
      },
      publishDiagnostics: (value) => {
        events.publish('vscode.diagnostics', value);
      },
      publishInternal: (value) => {
        internalEvents.publish('file_saved_by_user', value);
      },
      publishActivity: (value) => {
        deps.internalEvents.publish(value);
      },
    },
  });
  const launcher: VSCodeLauncher = new VSCodeLauncher({
    clock: ctx.clock,
    onLaunched: (projectId, root, launchedAt) => {
      bridge.recordLaunch(projectId, root, launchedAt);
    },
    processes: deps.processes,
    fileSystem: ctx.fileSystem,
    runner: new NodeCodeCliRunner(ctx.env),
    logger,
    events: {
      publishStatus: (value) => {
        vscodeStatus = { ...value, connected: vscodeConnected };
        events.publish('vscode.status', vscodeStatus);
      },
    },
    env: ctx.env,
    platform: process.platform,
    repositoryRoot: deps.repositoryRoot,
    e2e: ctx.e2e,
    connected: () => vscodeConnected,
  });
  return {
    enabled: deps.enabled,
    bridge,
    launcher,
    internalEvents,
    /** Reopens the VS Code session of the active project after a restart. */
    restoreActiveSession: (listProjects: () => Promise<Result<readonly Project[]>>) => {
      void (async () => {
        if (!deps.enabled) return;
        const current = await settings.get();
        if (!current.ok || current.value.activeProjectId === null) return;
        const projects = await listProjects();
        if (!projects.ok) return;
        const activeProject = projects.value.find((project) => project.id === current.value.activeProjectId);
        if (activeProject === undefined) return;
        await bridge.activate(activeProject.id, activeProject.workspaceRoot);
        await launcher.activate({
          projectId: activeProject.id,
          workspaceRoot: activeProject.workspaceRoot,
          settings: current.value.vscode,
        });
      })().catch((error: unknown) => {
        logger.error(
          { svc: 'vscode-bridge', error: error instanceof Error ? error.message : 'unknown' },
          'Could not restore active VS Code session',
        );
      });
    },
    /** Shutdown: close the windows IT Studio opened (per settings), then stop the bridge. */
    stop: async () => {
      const current = await settings.get();
      if (current.ok) await bridge.closeWindows(current.value.vscode, 'studio_exit');
      await bridge.stop();
    },
  };
}

export type VscodeModule = ReturnType<typeof createVscodeModule>;
export { registerVscodeRpc } from './rpc.js';
