import * as vscode from 'vscode';
import { ProviderId, type ProviderId as ProviderIdType } from '@itstudio/schemas';
import { statusLabel } from './status';

const EXTENSION_PROVIDER: ProviderIdType = ProviderId.ANTHROPIC;

export function activate(context: vscode.ExtensionContext): void {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  statusBarItem.text = statusLabel('idle');
  statusBarItem.tooltip = `Provider support: ${EXTENSION_PROVIDER}`;
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

export function deactivate(): void {
  return undefined;
}
