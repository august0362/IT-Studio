import { describe, expect, it } from 'vitest';
import { CommandKind, ErrorCode, PipelineStage, ProviderId } from '@itstudio/schemas';
import type { AppError, CommandRun } from '@itstudio/schemas';
import { commandRunIdSchema, pipelineRunIdSchema, workspaceRelativePathSchema } from '../validation/brand.js';
import { FailureReportBuilder } from './failure-report-builder.js';

const builder = new FailureReportBuilder();

function makeError(overrides: Partial<AppError> = {}): AppError {
  return {
    code: ErrorCode.COMMAND_FAILED,
    message: 'Validation failed.',
    retryable: false,
    ...overrides,
  };
}

function makeCommandRun(): CommandRun {
  return {
    id: commandRunIdSchema.parse('00000000-0000-4000-8000-000000000001'),
    spec: { kind: CommandKind.TYPECHECK, executable: 'node', args: [], timeoutMs: 1000 },
    exitCode: 1,
    timedOut: false,
    durationMs: 2,
    stdoutTail: '',
    stderrTail: '',
    diagnostics: [
      {
        source: 'tsc',
        severity: 'error',
        path: workspaceRelativePathSchema.parse('src/app.ts'),
        line: 8,
        column: 2,
        message: 'Cannot find name value.',
      },
    ],
  };
}

describe('FailureReportBuilder', () => {
  it('uses explicit remediation and preserves run and rollback fields', () => {
    const report = builder.build({
      runId: pipelineRunIdSchema.parse('00000000-0000-4000-8000-000000000002'),
      stage: PipelineStage.ROLLED_BACK,
      error: makeError({ remediation: ['Run the checks again.'] }),
      rolledBack: true,
      restoredSnapshot: 'snapshot-1',
      logLines: [],
    });
    expect(report.nextSteps).toEqual(['Run the checks again.']);
    expect(report.rolledBack).toBe(true);
    expect(report.restoredSnapshot).toBe('snapshot-1');
  });

  it('builds contextual fallback remediation from command runs', () => {
    const report = builder.build({
      stage: PipelineStage.VALIDATING,
      error: makeError(),
      rolledBack: false,
      commandRuns: [makeCommandRun()],
      logLines: [],
    });
    expect(report.nextSteps[0]).toContain('typecheck');
    expect(report.nextSteps[0]).toContain('src/app.ts:8: Cannot find name value.');
  });

  it('handles command runs without failing diagnostics and ignores malformed model context', () => {
    const passingCommand = { ...makeCommandRun(), exitCode: 0, diagnostics: [] };
    const noDiagnosticFailure = { ...makeCommandRun(), diagnostics: [] };
    const passing = builder.build({
      stage: PipelineStage.VALIDATING,
      error: makeError(),
      rolledBack: false,
      commandRuns: [passingCommand],
      logLines: [],
    });
    const missingDiagnostic = builder.build({
      stage: PipelineStage.VALIDATING,
      error: makeError(),
      rolledBack: false,
      commandRuns: [noDiagnosticFailure],
      logLines: [],
    });
    const malformedModels = builder.build({
      stage: PipelineStage.FAILED,
      error: makeError({ code: ErrorCode.LADDER_EXHAUSTED, details: { modelsTried: ['openai/model-a', 1] } }),
      rolledBack: false,
      logLines: [],
    });
    const emptyModels = builder.build({
      stage: PipelineStage.FAILED,
      error: makeError({ code: ErrorCode.LADDER_EXHAUSTED, details: { modelsTried: [] } }),
      rolledBack: false,
      logLines: [],
    });
    expect(passing.nextSteps[0]).not.toContain('typecheck');
    expect(missingDiagnostic.nextSteps[0]).toContain('typecheck');
    expect(malformedModels.nextSteps[0]).toContain('Choose another enabled model');
    expect(emptyModels.nextSteps[0]).toContain('Choose another enabled model');
  });

  it('redacts every scanner secret pattern and shortens Windows and Unix home paths', () => {
    const lines = [
      `anthropic sk-ant-${'a'.repeat(24)}`,
      `openai sk-${'b'.repeat(24)}`,
      `google AIza${'C'.repeat(35)}`,
      `xai xai-${'d'.repeat(24)}`,
      `groq gsk_${'e'.repeat(24)}`,
      `replicate r8_${'f'.repeat(24)}`,
      `private ${['-----BEGIN RSA ', 'PRIVATE KEY-----'].join('')}`,
      'path C:\\Users\\alice\\project\\file.ts and /home/bob/project/file.ts',
    ];
    const report = builder.build({
      stage: PipelineStage.FAILED,
      error: makeError(),
      rolledBack: false,
      logLines: lines,
    });
    expect(report.logExcerpt).not.toMatch(/sk-ant-|sk-|AIza|xai-|gsk_|r8_|PRIVATE KEY/);
    expect(report.logExcerpt).not.toContain('C:\\Users\\alice');
    expect(report.logExcerpt).toContain('~\\project\\file.ts');
    expect(report.logExcerpt).toContain('~/project/file.ts');
  });

  it('keeps only the last 60 lines and truncates each sanitized line to 300 characters', () => {
    const report = builder.build({
      stage: PipelineStage.FAILED,
      error: makeError(),
      rolledBack: false,
      logLines: Array.from({ length: 65 }, (_, index) => `${String(index)}:${'x'.repeat(350)}`),
    });
    const excerptLines = report.logExcerpt.split('\n');
    expect(excerptLines).toHaveLength(60);
    expect(excerptLines[0]).toMatch(/^5:/);
    expect(excerptLines.every((line) => line.length === 300)).toBe(true);
  });

  it('preserves failure wording and status whether the workspace was rolled back or left untouched', () => {
    const error = makeError({ message: 'The validation command failed.' });
    const untouched = builder.build({ stage: PipelineStage.FAILED, error, rolledBack: false, logLines: [] });
    const restored = builder.build({ stage: PipelineStage.ROLLED_BACK, error, rolledBack: true, logLines: [] });
    expect(untouched.error.message).toContain('failed');
    expect(untouched.rolledBack).toBe(false);
    expect(restored.rolledBack).toBe(true);
  });

  it('passes provider context from safe error details to remediation', () => {
    const report = builder.build({
      stage: PipelineStage.FAILED,
      error: makeError({ code: ErrorCode.PROVIDER_AUTH, details: { provider: ProviderId.ANTHROPIC } }),
      rolledBack: false,
      logLines: [],
    });
    expect(report.nextSteps[0]).toContain('anthropic');
  });

  it('uses a journal path from error details when rollback fails', () => {
    const report = builder.build({
      stage: PipelineStage.ROLLED_BACK,
      error: makeError({ code: ErrorCode.ROLLBACK_FAILED, details: { journalPath: 'C:/project/.itstudio/tx/tx-1' } }),
      rolledBack: false,
      logLines: [],
    });
    expect(report.nextSteps[0]).toContain('C:/project/.itstudio/tx/tx-1');
  });
});
