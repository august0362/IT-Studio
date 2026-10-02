import { relative, resolve, sep } from 'node:path';
import { normalizeRelative } from '../path-guard.js';
import type { Diagnostic, WorkspaceRelativePath } from '@itstudio/schemas';

const UNKNOWN_PATH = 'unknown' as WorkspaceRelativePath;

export function normalizeOutputPath(rawPath: string, cwd: string): WorkspaceRelativePath {
  const absolute = resolve(cwd, rawPath);
  const rel = relative(resolve(cwd), absolute);
  const normalized = normalizeRelative(rel.split(sep).join('/'));
  if (normalized.ok) return normalized.value;
  return UNKNOWN_PATH;
}

export function parseTscOutput(output: string, cwd: string): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const pattern = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.*)$/gm;
  for (const match of output.matchAll(pattern)) {
    const file = String(match[1]);
    const line = Number(match[2]);
    const column = Number(match[3]);
    const severityText = String(match[4]);
    const code = String(match[5]);
    const message = String(match[6]);
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 1 || column < 1) continue;
    diagnostics.push({
      source: 'tsc',
      severity: severityText === 'error' ? 'error' : 'warning',
      path: normalizeOutputPath(file, cwd),
      line,
      column,
      code,
      message,
    });
  }
  if (output.trim().length > 0 && diagnostics.length === 0) return [parseFailureDiagnostic('tsc')];
  return diagnostics;
}

export function parseFailureDiagnostic(source: Diagnostic['source']): Diagnostic {
  return {
    source,
    severity: 'info',
    path: UNKNOWN_PATH,
    line: 1,
    column: 1,
    message: 'Command output could not be parsed.',
  };
}
