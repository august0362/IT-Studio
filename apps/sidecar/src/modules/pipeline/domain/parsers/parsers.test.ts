import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseEslintOutput } from './eslint.js';
import { parseTscOutput } from './tsc.js';
import { parseVitestOutput } from './vitest.js';

const cwd = 'C:/workspace/project';
const fixture = (name: string): Promise<string> => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('validation output parsers', () => {
  it('parses multiple tsc errors into workspace relative paths', async () => {
    const parsed = parseTscOutput(await fixture('tsc-output.txt'), cwd);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      source: 'tsc',
      severity: 'error',
      path: 'src/main.ts',
      line: 4,
      column: 9,
      code: 'TS2322',
    });
    expect(parsed[1]?.path).toBe('src/lib/math.ts');
  });

  it('parses eslint warnings and errors from JSON', async () => {
    const parsed = parseEslintOutput(await fixture('eslint-output.json'), cwd);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ severity: 'warning', code: 'no-unused-vars', path: 'src/main.ts' });
    expect(parsed[1]).toMatchObject({ severity: 'error', code: '@typescript-eslint/no-explicit-any' });
  });

  it('summarizes vitest pass, failure and skipped tests with a failure diagnostic', async () => {
    const parsed = parseVitestOutput(await fixture('vitest-output.json'), cwd);
    expect(parsed.tests).toMatchObject({ passed: 1, failed: 1, skipped: 2 });
    expect(parsed.tests.failures[0]).toMatchObject({ name: 'rejects invalid input', path: 'src/math.test.ts' });
    expect(parsed.diagnostics[0]).toMatchObject({ source: 'vitest', severity: 'error', path: 'src/math.test.ts' });
  });

  it('returns a single info diagnostic for malformed tsc, eslint and vitest output', () => {
    const tsc = parseTscOutput('not compiler output', cwd);
    expect(tsc).toMatchObject([{ severity: 'info', source: 'tsc' }]);
    expect(parseEslintOutput('{bad json', cwd)).toMatchObject([{ severity: 'info', source: 'eslint' }]);
    expect(parseVitestOutput('{bad json', cwd)).toMatchObject({
      diagnostics: [{ severity: 'info', source: 'vitest' }],
    });
  });

  it('handles invalid tsc locations and paths outside the workspace', () => {
    const parsed = parseTscOutput(
      'src/zero.ts(0,2): error TS1000: invalid line\nsrc/large.ts(999999999999999999999,1): error TS1001: invalid line\n../outside.ts(1,1): warning TS1002: outside',
      cwd,
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ severity: 'warning', path: 'unknown', code: 'TS1002' });
  });

  it('turns structurally invalid eslint JSON into one parse diagnostic', () => {
    expect(parseEslintOutput('{"valid":false}', cwd)).toMatchObject([
      { severity: 'info', source: 'eslint', message: 'Command output could not be parsed.' },
    ]);
    expect(
      parseEslintOutput('[{"filePath":"src/a.ts","messages":[{"severity":1,"message":"bad line","line":1.5}]}]', cwd),
    ).toMatchObject([{ severity: 'info', source: 'eslint' }]);
  });

  it('uses safe defaults for sparse eslint messages and unknown vitest statuses', () => {
    const eslint = parseEslintOutput(
      '[{"filePath":"../outside.ts","messages":[{"severity":2,"message":"fatal"}]}]',
      cwd,
    );
    expect(eslint[0]).toMatchObject({ severity: 'error', path: 'unknown', line: 1, column: 1 });

    const vitest = parseVitestOutput(
      '{"testResults":[{"name":"src/sparse.test.ts","assertionResults":[{"status":"failed"},{"title":"case","status":"unknown","failureMessages":[]}]}]}',
      cwd,
    );
    expect(vitest.tests).toMatchObject({
      failed: 2,
      failures: [
        { name: 'Unnamed test', message: 'Test Unnamed test failed.' },
        { name: 'case', message: 'Test case failed.' },
      ],
    });
  });

  it('uses vitest summary counts when assertion details are absent and rejects invalid structures', () => {
    expect(parseVitestOutput('{"numPassedTests":5,"numFailedTests":2,"numPendingTests":1}', cwd).tests).toMatchObject({
      passed: 5,
      failed: 2,
      skipped: 1,
    });
    expect(parseVitestOutput('{"testResults":[{"name":42}]}', cwd)).toMatchObject({
      diagnostics: [{ severity: 'info', source: 'vitest' }],
      tests: { passed: 0, failed: 0, skipped: 0 },
    });
    expect(parseVitestOutput('{"testResults":[{"name":"src/empty.test.ts"}]}', cwd).tests).toMatchObject({
      passed: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    });
  });

  it('keeps empty valid eslint and vitest reports empty', () => {
    expect(parseEslintOutput('[]', cwd)).toEqual([]);
    expect(parseVitestOutput('{"testResults":[]}', cwd)).toMatchObject({
      tests: { passed: 0, failed: 0, skipped: 0, failures: [] },
      diagnostics: [],
    });
  });
});
