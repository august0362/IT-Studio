import * as vscode from 'vscode';
import { ProviderId, type ProviderId as ProviderIdType } from '@itstudio/schemas';

const EXTENSION_PROVIDER: ProviderIdType = ProviderId.ANTHROPIC;

export function activate(context: vscode.ExtensionContext): void {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  statusBarItem.text = 'IT Studio: idle';
  statusBarItem.tooltip = `Provider support: ${EXTENSION_PROVIDER}`;
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

export function deactivate(): void {}
