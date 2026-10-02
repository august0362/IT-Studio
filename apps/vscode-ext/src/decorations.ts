import * as vscode from 'vscode';

export class TransactionDecorations implements vscode.Disposable {
  private readonly paths = new Set<string>();
  private readonly decoration: vscode.TextEditorDecorationType;
  private readonly visibleEditorSubscription: vscode.Disposable;

  public constructor() {
    this.decoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.modifiedForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
    });
    this.visibleEditorSubscription = vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) this.apply(editor);
    });
  }

  public decorate(absolutePaths: readonly string[]): void {
    this.paths.clear();
    for (const filePath of absolutePaths) this.paths.add(vscode.Uri.file(filePath).fsPath);
    for (const editor of vscode.window.visibleTextEditors) this.apply(editor);
  }

  public clear(): void {
    this.paths.clear();
    for (const editor of vscode.window.visibleTextEditors) editor.setDecorations(this.decoration, []);
  }

  public dispose(): void {
    this.clear();
    this.visibleEditorSubscription.dispose();
    this.decoration.dispose();
  }

  private apply(editor: vscode.TextEditor): void {
    if (!this.paths.has(editor.document.uri.fsPath)) {
      editor.setDecorations(this.decoration, []);
      return;
    }
    const lastLine = Math.max(0, editor.document.lineCount - 1);
    editor.setDecorations(this.decoration, [new vscode.Range(0, 0, lastLine, 0)]);
  }
}
