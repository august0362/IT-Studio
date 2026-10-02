import { describe, expect, it } from 'vitest';
import type { SidecarToExt } from '@itstudio/schemas';
import { mapDiagnostics, registerActions, resolveWorkspacePath, type EditorPort } from './actions';
import { DiffContentStore } from './diff-store';

function message(value: object): SidecarToExt {
  return value as SidecarToExt;
}

class FakeEditor implements EditorPort {
  public readonly workspaceRoot = 'C:/project';
  public readonly revealed: { readonly path: string; readonly line?: number }[] = [];
  public readonly diffs: {
    readonly path: string;
    readonly before: string;
    readonly after: string;
    readonly title: string;
  }[] = [];
  public readonly decorated: (readonly string[])[] = [];
  public readonly notifications: { readonly level: string; readonly message: string }[] = [];
  public readonly acknowledgements: number[] = [];
  public readonly logs: string[] = [];
  public sentDiagnostics: readonly unknown[] = [];
  public diagnostics: ReturnType<EditorPort['getDiagnostics']> = [];
  public revealSetting = true;
  public cleared = 0;

  public async reveal(absolutePath: string, line?: number): Promise<void> {
    this.revealed.push({ path: absolutePath, ...(line === undefined ? {} : { line }) });
    await Promise.resolve();
  }
  public async showDiff(absolutePath: string, before: string, after: string, title: string): Promise<void> {
    this.diffs.push({ path: absolutePath, before, after, title });
    await Promise.resolve();
  }
  public decorate(absolutePaths: readonly string[]): void {
    this.decorated.push(absolutePaths);
  }
  public clearDecorations(): void {
    this.cleared += 1;
  }
  public notify(level: 'info' | 'warning' | 'error', messageText: string): void {
    this.notifications.push({ level, message: messageText });
  }
  public getDiagnostics(): ReturnType<EditorPort['getDiagnostics']> {
    return this.diagnostics;
  }
  public sendDiagnostics(diagnostics: Parameters<EditorPort['sendDiagnostics']>[0]): void {
    this.sentDiagnostics = diagnostics;
  }
  public ack(ref: number): void {
    this.acknowledgements.push(ref);
  }
  public revealChangedFiles(): boolean {
    return this.revealSetting;
  }
  public log(messageText: string): void {
    this.logs.push(messageText);
  }
}

function setup(revealSetting = true): { readonly editor: FakeEditor; readonly dispatch: (value: object) => void } {
  const editor = new FakeEditor();
  editor.revealSetting = revealSetting;
  let handler: ((value: SidecarToExt) => void) | undefined;
  registerActions((next) => {
    handler = next;
    return () => {
      handler = undefined;
    };
  }, editor);
  return {
    editor,
    dispatch: (value) => {
      if (!handler) throw new Error('Handler was not registered');
      handler(message(value));
    },
  };
}

describe('sidecar actions', () => {
  it('reveals files and acknowledges the request', () => {
    const { editor, dispatch } = setup();
    dispatch({ type: 'reveal', ref: 4, path: 'src/app.ts', line: 8 });
    expect(editor.revealed).toEqual([{ path: 'C:\\project\\src\\app.ts', line: 8 }]);
    expect(editor.acknowledgements).toEqual([4]);
  });

  it('shows a before and after diff and acknowledges it', () => {
    const { editor, dispatch } = setup();
    dispatch({ type: 'show_diff', ref: 5, path: 'src/app.ts', before: 'old', after: 'new', title: 'Change' });
    expect(editor.diffs).toEqual([{ path: 'C:\\project\\src\\app.ts', before: 'old', after: 'new', title: 'Change' }]);
    expect(editor.acknowledgements).toEqual([5]);
  });

  it('decorates all committed paths and optionally reveals the first', () => {
    const { editor, dispatch } = setup();
    dispatch({ type: 'transaction', ref: 6, transactionId: 'tx', status: 'committed', paths: ['a.ts', 'sub/b.ts'] });
    expect(editor.decorated).toEqual([['C:\\project\\a.ts', 'C:\\project\\sub\\b.ts']]);
    expect(editor.revealed).toEqual([{ path: 'C:\\project\\a.ts' }]);
    expect(editor.acknowledgements).toEqual([6]);
  });

  it('decorates without revealing when the setting is disabled and handles an empty transaction', () => {
    const { editor, dispatch } = setup(false);
    dispatch({ type: 'transaction', ref: 7, transactionId: 'tx', status: 'committed', paths: [] });
    expect(editor.decorated).toEqual([[]]);
    expect(editor.revealed).toEqual([]);
    expect(editor.acknowledgements).toEqual([7]);
  });

  it('clears decorations and warns when a transaction rolls back', () => {
    const { editor, dispatch } = setup();
    dispatch({ type: 'transaction', ref: 8, transactionId: 'tx-8', status: 'rolled_back', paths: [] });
    expect(editor.cleared).toBe(1);
    expect(editor.notifications).toEqual([{ level: 'warning', message: 'Transaction tx-8 was rolled back.' }]);
    expect(editor.acknowledgements).toEqual([8]);
  });

  it('acknowledges transactions that need no visual action', () => {
    const { editor, dispatch } = setup();
    dispatch({ type: 'transaction', ref: 9, transactionId: 'tx', status: 'prepared', paths: [] });
    expect(editor.acknowledgements).toEqual([9]);
    expect(editor.cleared).toBe(0);
  });

  it('shows each notification level and acknowledges it', () => {
    const { editor, dispatch } = setup();
    for (const [index, level] of (['info', 'warning', 'error'] as const).entries()) {
      dispatch({ type: 'notify', ref: index + 10, level, message: level });
    }
    expect(editor.notifications).toEqual([
      { level: 'info', message: 'info' },
      { level: 'warning', message: 'warning' },
      { level: 'error', message: 'error' },
    ]);
    expect(editor.acknowledgements).toEqual([10, 11, 12]);
  });

  it('returns workspace diagnostics and acknowledges the request', () => {
    const { editor, dispatch } = setup();
    editor.diagnostics = [
      {
        path: 'C:/project/src/app.ts',
        diagnostics: [
          { severity: 0, line: 0, column: 0, message: 'error', code: 2322 },
          { severity: 1, line: 1, column: 2, message: 'warning' },
          { severity: 2, line: 2, column: 3, message: 'info' },
          { severity: 3, line: 3, column: 4, message: 'hint' },
        ],
      },
    ];
    dispatch({ type: 'request_diagnostics', ref: 13 });
    expect(editor.sentDiagnostics).toEqual([
      { source: 'vscode', severity: 'error', path: 'src/app.ts', line: 1, column: 1, message: 'error', code: '2322' },
      { source: 'vscode', severity: 'warning', path: 'src/app.ts', line: 2, column: 3, message: 'warning' },
      { source: 'vscode', severity: 'info', path: 'src/app.ts', line: 3, column: 4, message: 'info' },
      { source: 'vscode', severity: 'info', path: 'src/app.ts', line: 4, column: 5, message: 'hint' },
    ]);
    expect(editor.acknowledgements).toEqual([13]);
  });

  it('acks and logs rejected paths without opening or showing diffs', () => {
    const { editor, dispatch } = setup();
    for (const [index, value] of [
      '/outside/file.ts',
      '../secret',
      'nested/../../secret',
      'C:/outside/file.ts',
    ].entries()) {
      dispatch({ type: 'reveal', ref: index + 20, path: value });
    }
    dispatch({ type: 'show_diff', ref: 24, path: '../secret', before: '', after: '', title: 'Unsafe' });
    expect(editor.revealed).toEqual([]);
    expect(editor.diffs).toEqual([]);
    expect(editor.logs).toHaveLength(5);
    expect(editor.acknowledgements).toEqual([20, 21, 22, 23, 24]);
  });

  it('skips unsafe transaction paths while applying safe paths', () => {
    const { editor, dispatch } = setup();
    dispatch({
      type: 'transaction',
      ref: 25,
      transactionId: 'tx',
      status: 'committed',
      paths: ['../bad', 'src/good.ts'],
    });
    expect(editor.decorated).toEqual([['C:\\project\\src\\good.ts']]);
    expect(editor.revealed).toEqual([]);
    expect(editor.logs).toHaveLength(1);
    expect(editor.acknowledgements).toEqual([25]);
  });
});

describe('workspace paths and diagnostics', () => {
  it('normalizes valid paths and rejects absolute, traversal, and root paths', () => {
    expect(resolveWorkspacePath('C:/project', 'src\\file.ts')).toEqual({
      absolutePath: 'C:\\project\\src\\file.ts',
      relativePath: 'src/file.ts',
    });
    expect(resolveWorkspacePath('C:/project', '/outside')).toBeUndefined();
    expect(resolveWorkspacePath('C:/project', 'C:/outside')).toBeUndefined();
    expect(resolveWorkspacePath('C:/project', '..')).toBeUndefined();
    expect(resolveWorkspacePath('C:/project', '.')).toBeUndefined();
    expect(resolveWorkspacePath('C:/project', 'C:relative')).toBeUndefined();
  });

  it('omits diagnostics that resolve outside the workspace', () => {
    expect(
      mapDiagnostics('C:/project', [
        {
          path: 'C:/elsewhere/file.ts',
          diagnostics: [{ severity: 0, line: 0, column: 0, message: 'external' }],
        },
      ]),
    ).toEqual([]);
  });
});

describe('diff content LRU', () => {
  it('retains the 20 newest entries and refreshes recently read entries', () => {
    const store = new DiffContentStore();
    for (let index = 0; index < 20; index += 1) {
      store.set(String(index), { path: `${String(index)}.ts`, before: 'before', after: 'after' });
    }
    expect(store.get('0')).toBeDefined();
    store.set('20', { path: '20.ts', before: 'before', after: 'after' });
    expect(store.size).toBe(20);
    expect(store.get('0')).toBeDefined();
    expect(store.get('1')).toBeUndefined();
    expect(store.get('20')).toBeDefined();
  });
});
