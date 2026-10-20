import { z } from 'zod';
import type { Diagnostic, TestSummary } from '@itstudio/schemas';
import { normalizeOutputPath, parseFailureDiagnostic } from './tsc.js';

const assertionSchema = z.object({
  fullName: z.string().optional(),
  title: z.string().optional(),
  status: z.string(),
  failureMessages: z.array(z.string()).optional(),
});
const suiteSchema = z.object({
  name: z.string(),
  assertionResults: z.array(assertionSchema).optional(),
});
const reportSchema = z.object({
  numPassedTests: z.number().optional(),
  numFailedTests: z.number().optional(),
  numPendingTests: z.number().optional(),
  testResults: z.array(suiteSchema).optional(),
});

export interface VitestParseResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly tests: TestSummary;
}

function pathFor(file: string, cwd: string): Diagnostic['path'] {
  return normalizeOutputPath(file, cwd);
}

export function parseVitestOutput(output: string, cwd: string): VitestParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(output);
  } catch {
    return {
      diagnostics: [parseFailureDiagnostic('vitest')],
      tests: { passed: 0, failed: 0, skipped: 0, failures: [] },
    };
  }
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      diagnostics: [parseFailureDiagnostic('vitest')],
      tests: { passed: 0, failed: 0, skipped: 0, failures: [] },
    };
  }
  const suites = parsed.data.testResults ?? [];
  const failures: TestSummary['failures'][number][] = [];
  const diagnostics: Diagnostic[] = [];
  let passed = parsed.data.numPassedTests ?? 0;
  let failed = parsed.data.numFailedTests ?? 0;
  let skipped = parsed.data.numPendingTests ?? 0;
  if (parsed.data.testResults !== undefined) {
    passed = 0;
    failed = 0;
    skipped = 0;
    for (const suite of suites) {
      for (const assertion of suite.assertionResults ?? []) {
        const name = assertion.fullName ?? assertion.title ?? 'Unnamed test';
        const message = (assertion.failureMessages ?? []).join('\n') || `Test ${name} failed.`;
        const status = assertion.status.toLowerCase();
        if (status === 'passed') passed += 1;
        else if (status === 'pending' || status === 'skipped' || status === 'todo') skipped += 1;
        else {
          failed += 1;
          failures.push({ name, message, path: pathFor(suite.name, cwd) });
          diagnostics.push({
            source: 'vitest',
            severity: 'error',
            path: pathFor(suite.name, cwd),
            line: 1,
            column: 1,
            message: `${name}: ${message}`,
          });
        }
      }
    }
  }
  return { diagnostics, tests: { passed, failed, skipped, failures } };
}
