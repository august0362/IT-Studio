import path from 'node:path';
import type { Diagnostic, SidecarToExt } from '@itstudio/schemas';

export interface EditorDiagnostic {
  readonly severity: number;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly code?: string | number;
}

export type DiagnosticMessage = Omit<Diagnostic, 'path'> & { readonly path: string };

export interface DiagnosticFile {
  readonly path: string;
  readonly diagnostics: readonly EditorDiagnostic[];
}

export interface EditorPort {
  readonly workspaceRoot: string;
  reveal(absolutePath: string, line?: number): Promise<void>;
  showDiff(absolutePath: string, before: string, after: string, title: string): Promise<void>;
  decorate(absolutePaths: readonly string[]): void;
  clearDecorations(): void;
  notify(level: 'info' | 'warning' | 'error', message: string): void;
  getDiagnostics(): readonly DiagnosticFile[];
  sendDiagnostics(diagnostics: readonly DiagnosticMessage[]): void;
  ack(ref: number): void;
  revealChangedFiles(): boolean;
  log(message: string): void;
}

export interface SafeWorkspacePath {
  readonly absolutePath: string;
  readonly relativePath: string;
}

export function resolveWorkspacePath(workspaceRoot: string, value: string): SafeWorkspacePath | undefined {
  if (!value || value.includes('\0') || path.isAbsolute(value) || path.win32.parse(value).root !== '') return undefined;
  const parts = value.split(/[\\/]+/);
  if (parts.some((part) => part === '..')) return undefined;

  const root = path.resolve(workspaceRoot);
  const absolutePath = path.resolve(root, value);
  const relative = path.relative(root, absolutePath);
  if (
    !relative ||
    relative === '.' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    return undefined;
  return { absolutePath, relativePath: relative.split(path.sep).join('/') };
}

export function mapDiagnostics(workspaceRoot: string, files: readonly DiagnosticFile[]): readonly DiagnosticMessage[] {
  const mapped: DiagnosticMessage[] = [];
  for (const file of files) {
    const diagnosticPath =
      path.isAbsolute(file.path) || path.win32.parse(file.path).root !== ''
        ? path.relative(path.resolve(workspaceRoot), path.resolve(file.path))
        : file.path;
    const safe = resolveWorkspacePath(workspaceRoot, diagnosticPath);
    if (!safe) continue;
    for (const diagnostic of file.diagnostics) {
      mapped.push({
        source: 'vscode',
        severity: diagnostic.severity === 0 ? 'error' : diagnostic.severity === 1 ? 'warning' : 'info',
        path: safe.relativePath,
        line: diagnostic.line + 1,
        column: diagnostic.column + 1,
        message: diagnostic.message,
        ...(diagnostic.code === undefined ? {} : { code: String(diagnostic.code) }),
      });
    }
  }
  return mapped;
}

export function registerActions(
  onMessage: (handler: (message: SidecarToExt) => void) => () => void,
  editor: EditorPort,
): () => void {
  return onMessage((message) => {
    switch (message.type) {
      case 'reveal': {
        const safe = resolveWorkspacePath(editor.workspaceRoot, message.path);
        if (safe) void editor.reveal(safe.absolutePath, message.line);
        else editor.log(`Rejected unsafe reveal path: ${message.path}`);
        editor.ack(message.ref);
        return;
      }
      case 'show_diff': {
        const safe = resolveWorkspacePath(editor.workspaceRoot, message.path);
        if (safe) void editor.showDiff(safe.absolutePath, message.before, message.after, message.title);
        else editor.log(`Rejected unsafe diff path: ${message.path}`);
        editor.ack(message.ref);
        return;
      }
      case 'transaction': {
        if (message.status === 'committed') {
          const paths = message.paths.flatMap((candidate) => {
            const safe = resolveWorkspacePath(editor.workspaceRoot, candidate);
            if (!safe) {
              editor.log(`Rejected unsafe transaction path: ${candidate}`);
              return [];
            }
            return [safe.absolutePath];
          });
          editor.decorate(paths);
          const firstPath = message.paths[0];
          const firstSafe = firstPath === undefined ? undefined : resolveWorkspacePath(editor.workspaceRoot, firstPath);
          if (editor.revealChangedFiles() && firstSafe) void editor.reveal(firstSafe.absolutePath);
        } else if (message.status === 'rolled_back' || message.status === 'rollback_failed') {
          editor.clearDecorations();
          editor.notify('warning', `Transaction ${message.transactionId} was rolled back.`);
        }
        editor.ack(message.ref);
        return;
      }
      case 'notify':
        editor.notify(message.level, message.message);
        editor.ack(message.ref);
        return;
      case 'request_diagnostics':
        editor.sendDiagnostics(mapDiagnostics(editor.workspaceRoot, editor.getDiagnostics()));
        editor.ack(message.ref);
        return;
      case 'welcome':
      case 'ping':
        return;
    }
  });
}
