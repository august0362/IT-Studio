import { describe, expect, it } from 'vitest';
import { CommandKind, ErrorCode, ProviderId } from '@itstudio/schemas';
import { remediationFor } from './remediation.js';

describe('remediationFor', () => {
  it('provides one to four steps for every error code', () => {
    for (const code of Object.values(ErrorCode)) {
      const steps = remediationFor(code);
      expect(steps.length, code).toBeGreaterThanOrEqual(1);
      expect(steps.length, code).toBeLessThanOrEqual(4);
      expect(
        steps.every((step) => step.length > 0),
        code,
      ).toBe(true);
    }
  });

  it('includes file paths for patch conflicts', () => {
    expect(remediationFor(ErrorCode.PATCH_CONFLICT, { files: ['src/app.ts', 'README.md'] })[0]).toContain(
      'src/app.ts, README.md',
    );
    expect(remediationFor(ErrorCode.PATCH_CONFLICT, { files: [] })[0]).toContain('changed files');
  });

  it('includes the command kind and first diagnostic for command failures', () => {
    const steps = remediationFor(ErrorCode.COMMAND_FAILED, {
      commandKind: CommandKind.TYPECHECK,
      firstDiagnostic: 'src/app.ts:4: missing name',
    });
    expect(steps[0]).toContain('typecheck');
    expect(steps[0]).toContain('src/app.ts:4: missing name');
    expect(remediationFor(ErrorCode.COMMAND_FAILED, { commandKind: CommandKind.TYPECHECK })[0]).not.toContain(': ');
    expect(remediationFor(ErrorCode.COMMAND_FAILED, { firstDiagnostic: 'missing value' })[0]).toContain(
      'missing value',
    );
  });

  it('includes the transaction journal for rollback failures', () => {
    expect(remediationFor(ErrorCode.ROLLBACK_FAILED, { journalPath: 'C:/project/.itstudio/tx/abc' })[0]).toContain(
      'C:/project/.itstudio/tx/abc',
    );
    expect(remediationFor(ErrorCode.ROLLBACK_FAILED, { journalPath: '' })[0]).toContain('Locate the transaction');
  });

  it('uses budget context, provider, and tried models when available', () => {
    expect(remediationFor(ErrorCode.BUDGET_HARD_STOP, { budget: { spent: '$11', limit: '$10' } })[0]).toContain(
      '$11 spent of $10',
    );
    expect(remediationFor(ErrorCode.PROVIDER_AUTH, { provider: ProviderId.OPENAI })[0]).toContain('openai');
    expect(
      remediationFor(ErrorCode.LADDER_EXHAUSTED, { modelsTried: ['openai/model-a', 'google/model-b'] })[0],
    ).toContain('openai/model-a, google/model-b');
    expect(remediationFor(ErrorCode.LADDER_EXHAUSTED, { modelsTried: [] })[0]).toContain('Choose another enabled');
  });
});
