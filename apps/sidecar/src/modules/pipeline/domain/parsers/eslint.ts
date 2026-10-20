import { z } from 'zod';
import type { Diagnostic } from '@itstudio/schemas';
import { normalizeOutputPath, parseFailureDiagnostic } from './tsc.js';

const messageSchema = z.object({
  ruleId: z.string().nullable().optional(),
  severity: z.number(),
  message: z.string(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  endLine: z.number().optional(),
  endColumn: z.number().optional(),
});
const fileSchema = z.object({ filePath: z.string(), messages: z.array(messageSchema) });

function diagnosticPath(file: string, cwd: string): Diagnostic['path'] {
  return normalizeOutputPath(file, cwd);
}

export function parseEslintOutput(output: string, cwd: string): readonly Diagnostic[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return [parseFailureDiagnostic('eslint')];
  }
  const files = z.array(fileSchema).safeParse(parsed);
  if (!files.success) return [parseFailureDiagnostic('eslint')];
  const diagnostics: Diagnostic[] = [];
  for (const file of files.data) {
    for (const message of file.messages) {
      const line = message.line ?? 1;
      const column = message.column ?? 1;
      diagnostics.push({
        source: 'eslint',
        severity: message.severity === 1 ? 'warning' : 'error',
        path: diagnosticPath(file.filePath, cwd),
        line,
        column,
        ...(message.ruleId ? { code: message.ruleId } : {}),
        message: message.message,
      });
    }
  }
  return diagnostics;
}
