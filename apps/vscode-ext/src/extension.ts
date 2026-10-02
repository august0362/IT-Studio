import * as vscode from 'vscode';
import { SidecarBridge } from './bridge';
import type { WebSocketLike } from './bridge';
import { statusLabel } from './status';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('IT Studio');
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  statusBarItem.text = statusLabel('idle');
  statusBarItem.tooltip = 'IT Studio sidecar connection';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push(output);

  const folder = await findWorkspaceFolder();
  if (!folder) return;
  const packageJson: unknown = context.extension.packageJSON;
  const extensionVersion =
    isRecord(packageJson) && typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
  function connect(): void {
    bridge.connect();
  }
  const bridge = new SidecarBridge({
    workspaceRoot: folder.uri.fsPath,
    extensionVersion,
    fs: {
      readFile: async (path) => new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(path))),
    },
    createSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
    clock: {
      setTimeout: (callback, delay) => {
        return setTimeout(callback, delay);
      },
      clearTimeout: (handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
    },
    logger: (message) => {
      output.appendLine(message);
    },
    onState: (state) => {
      statusBarItem.text = statusLabel(state);
    },
  });
  connect();
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, '.itstudio/session.json'),
  );
  watcher.onDidChange(() => {
    connect();
  });
  watcher.onDidCreate(() => {
    connect();
  });
  context.subscriptions.push(watcher, {
    dispose: () => {
      bridge.dispose();
    },
  });
  const reconnect = vscode.commands.registerCommand('itstudio.reconnect', connect);
  const showLog = vscode.commands.registerCommand('itstudio.showLog', () => {
    output.show();
  });
  context.subscriptions.push(reconnect, showLog);
  statusBarItem.command = 'itstudio.status';
  context.subscriptions.push(
    vscode.commands.registerCommand('itstudio.status', async () => {
      const selection = await vscode.window.showQuickPick(['Reconnect', 'Show log']);
      if (selection === 'Reconnect') {
        connect();
      }
      if (selection === 'Show log') {
        output.show();
      }
    }),
  );
}

export function deactivate(): void {
  return undefined;
}

async function findWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  for (const candidate of vscode.workspace.workspaceFolders ?? []) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(candidate.uri, '.itstudio', 'session.json'));
      return candidate;
    } catch {
      /* Continue to the next workspace folder. */
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
