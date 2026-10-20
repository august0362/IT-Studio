import type { FileOperation } from '@itstudio/schemas';

function lines(value: string): readonly string[] {
  if (value.length === 0) return [];
  const result = value.replaceAll('\r\n', '\n').split('\n');
  if (value.endsWith('\n')) result.pop();
  return result;
}

function fullFileDiff(path: string, before: string, after: string): string {
  const oldLines = lines(before);
  const newLines = lines(after);
  const oldHeader = before.length === 0 ? '--- /dev/null' : `--- a/${path}`;
  const newHeader = after.length === 0 ? '+++ /dev/null' : `+++ b/${path}`;
  const hunk = `@@ -${String(oldLines.length === 0 ? 0 : 1)},${String(oldLines.length)} +${String(newLines.length === 0 ? 0 : 1)},${String(newLines.length)} @@`;
  return [
    oldHeader,
    newHeader,
    hunk,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join('\n');
}

export function renderPipelineDiffs(
  operations: readonly FileOperation[],
  currentFiles: readonly { readonly path: string; readonly content: string }[],
): string {
  const originals = new Map(currentFiles.map((file) => [file.path, file.content]));
  return operations
    .map((operation) => {
      if (operation.kind === 'create') return fullFileDiff(operation.path, '', operation.content);
      if (operation.kind === 'replace')
        return fullFileDiff(operation.path, originals.get(operation.path) ?? '', operation.content);
      if (operation.kind === 'patch')
        return `--- a/${operation.path}\n+++ b/${operation.path}\n${operation.unifiedDiff}`;
      if (operation.kind === 'delete') return fullFileDiff(operation.path, originals.get(operation.path) ?? '', '');
      return `rename from ${operation.from}\nrename to ${operation.to}`;
    })
    .join('\n');
}
