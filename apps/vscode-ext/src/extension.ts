import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { registerActions, type DiagnosticFile, type EditorDiagnostic } from './actions';
import { SidecarBridge } from './bridge';
import type { WebSocketLike } from './bridge';
import { DiffDocumentProvider } from './diff-provider';
import { DiffContentStore } from './diff-store';
import { TransactionDecorations } from './decorations';
import { statusLabel } from './status';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('IT Studio');
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  statusBarItem.text = statusLabel('idle');
  statusBarItem.tooltip = 'IT Studio sidecar connection';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push(output);
  const diffStore = new DiffContentStore();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      DiffDocumentProvider.scheme,
      new DiffDocumentProvider(diffStore),
    ),
  );

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
  const decorations = new TransactionDecorations();
  context.subscriptions.push(decorations);
  const unregisterActions = registerActions((handler) => bridge.onMessage(handler), {
    workspaceRoot: folder.uri.fsPath,
    reveal: async (absolutePath, line) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath));
      const editor = await vscode.window.showTextDocument(document, { preserveFocus: false });
      if (line !== undefined) {
        const position = new vscode.Position(Math.max(0, line - 1), 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position));
      }
    },
    showDiff: async (absolutePath, before, after, title) => {
      const id = randomUUID();
      diffStore.set(id, { path: absolutePath, before, after });
      const beforeUri = vscode.Uri.parse(`${DiffDocumentProvider.scheme}:/${id}/before`);
      const afterUri = vscode.Uri.parse(`${DiffDocumentProvider.scheme}:/${id}/after`);
      await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, title);
    },
    decorate: (paths) => {
      decorations.decorate(paths);
    },
    clearDecorations: () => {
      decorations.clear();
    },
    notify: (level, message) => {
      if (level === 'info') void vscode.window.showInformationMessage(message);
      else if (level === 'warning') void vscode.window.showWarningMessage(message);
      else void vscode.window.showErrorMessage(message);
    },
    getDiagnostics: (): readonly DiagnosticFile[] =>
      vscode.languages.getDiagnostics().flatMap(([uri, values]) => {
        if (uri.scheme !== 'file') return [];
        const fileDiagnostics: EditorDiagnostic[] = values.map((diagnostic) => ({
          severity: diagnostic.severity,
          line: diagnostic.range.start.line,
          column: diagnostic.range.start.character,
          message: diagnostic.message,
          ...(diagnostic.code === undefined
            ? {}
            : { code: typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code }),
        }));
        return [{ path: uri.fsPath, diagnostics: fileDiagnostics }];
      }),
    sendDiagnostics: (diagnostics) => {
      bridge.sendSerialized(JSON.stringify({ type: 'diagnostics', diagnostics }));
    },
    ack: (ref) => {
      bridge.sendSerialized(JSON.stringify({ type: 'ack', ref }));
    },
    revealChangedFiles: () => vscode.workspace.getConfiguration('itstudio').get('revealChangedFiles', false),
    log: (message) => {
      output.appendLine(message);
    },
  });
  context.subscriptions.push({ dispose: unregisterActions });
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
