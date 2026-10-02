import type * as vscode from 'vscode';
import type { DiffContentStore } from './diff-store';

export class DiffDocumentProvider implements vscode.TextDocumentContentProvider {
  public static readonly scheme = 'itstudio-diff';
  private readonly store: DiffContentStore;

  public constructor(store: DiffContentStore) {
    this.store = store;
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    const [, id, side] = uri.path.split('/');
    const entry = id === undefined ? undefined : this.store.get(id);
    if (!entry) return '';
    return side === 'before' ? entry.before : side === 'after' ? entry.after : '';
  }
}
