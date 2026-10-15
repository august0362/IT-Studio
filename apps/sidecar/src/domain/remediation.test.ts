import { describe, expect, it } from 'vitest';
import {
  CommandKind,
  ErrorCode,
  FailureKind,
  ProviderId,
  type ModelDescriptor,
  type RouterAttempt,
} from '@itstudio/schemas';
import { isoDateTimeSchema } from '../validation/brand.js';
import { ladderFailureSummary, remediationFor } from './remediation.js';

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

describe('UX-02 ladder remediation', () => {
  it.each([
    [FailureKind.AUTH, 'key rejected (401)'],
    [FailureKind.TIMEOUT, 'timed out after 30 s'],
    [FailureKind.SERVER_ERROR, 'provider unavailable (401)'],
    [FailureKind.RATE_LIMITED, 'rate limited (401)'],
    [FailureKind.QUOTA_EXHAUSTED, 'quota exhausted (401)'],
    [FailureKind.BAD_REQUEST, 'request rejected (401)'],
    [FailureKind.CONTENT_FILTERED, 'content filtered'],
  ] as const)('OWNER-FB2-A retains the last %s behind a circuit skip', (failure, reason) => {
    const model: ModelDescriptor = {
      key: 'deepseek/deepseek-v4-flash',
      provider: ProviderId.DEEPSEEK,
      providerModelId: 'deepseek-v4-flash',
      displayName: 'DeepSeek',
      capabilities: ['chat'],
      contextWindowTokens: 100,
      maxOutputTokens: 10,
      enabled: true,
    };
    const attempt: RouterAttempt = {
      modelKey: model.key,
      startedAt: isoDateTimeSchema.parse('2026-10-16T00:00:00.000Z'),
      latencyMs: 0,
      outcome: 'skipped',
      failure: FailureKind.CIRCUIT_OPEN,
      skipReason: 'circuit_open',
    };
    const summary = ladderFailureSummary(
      [attempt],
      [model],
      new Map([
        [
          model.key,
          {
            modelKey: model.key,
            startedAt: attempt.startedAt,
            latencyMs: 0,
            outcome: 'failed',
            failure,
            httpStatus: 401,
          },
        ],
      ]),
    );
    expect(summary).toBe(`DeepSeek (deepseek-v4-flash): ${reason}`);
  });
  it('TC-UX2-remediation names missing providers and caps suggestions at three', () => {
    const steps = remediationFor(ErrorCode.LADDER_EXHAUSTED, {
      missingProviders: ['Anthropic', 'OpenAI'],
      suggestedModels: ['Google: One', 'Google: Two', 'Google: Three', 'Google: Four'],
    });
    expect(steps).toEqual([
      'Add an API key in Settings \u2192 API Keys for: Anthropic, OpenAI.',
      'Or add a model from a provider you have a key for (Google: One, Google: Two, Google: Three) to this role in Settings \u2192 Pipeline.',
    ]);
    expect(remediationFor(ErrorCode.LADDER_EXHAUSTED, { missingProviders: ['OpenAI'] })[1]).toContain(
      'provider you have a key for',
    );
  });
  it('TC-UX2-remediation handles an empty ladder without technical failure kinds', () => {
    expect(ladderFailureSummary([], [])).toBe('No models configured');
  });
});
