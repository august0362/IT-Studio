import {
  ProviderId,
  type AppError,
  type CommandRun,
  type FailureReport,
  type PipelineRunId,
  type PipelineStage,
} from '@itstudio/schemas';
import { remediationFor } from '../domain/remediation.js';
import { redactLogLine } from '../domain/redact.js';

export interface FailureReportInput {
  readonly runId?: PipelineRunId;
  readonly stage: PipelineStage;
  readonly error: AppError;
  readonly rolledBack: boolean;
  readonly restoredSnapshot?: string;
  readonly commandRuns?: readonly CommandRun[];
  readonly logLines: readonly string[];
}

export class FailureReportBuilder {
  build(input: FailureReportInput): FailureReport {
    const failedCommand = input.commandRuns?.find((run) => run.timedOut || run.exitCode !== 0);
    const firstDiagnostic = failedCommand?.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    const details = input.error.details;
    const providerValue = details?.provider;
    const modelsValue = details?.modelsTried;
    const provider =
      typeof providerValue === 'string'
        ? Object.values(ProviderId).find((providerId) => providerId === providerValue)
        : undefined;
    const context = {
      ...(failedCommand ? { commandKind: failedCommand.spec.kind } : {}),
      ...(firstDiagnostic
        ? { firstDiagnostic: `${firstDiagnostic.path}:${String(firstDiagnostic.line)}: ${firstDiagnostic.message}` }
        : {}),
      ...(typeof details?.journalPath === 'string' ? { journalPath: details.journalPath } : {}),
      ...(provider ? { provider } : {}),
      ...(Array.isArray(modelsValue) && modelsValue.every((model): model is string => typeof model === 'string')
        ? { modelsTried: modelsValue }
        : {}),
    };
    const lines = input.logLines.slice(-60).map((line) => redactLogLine(line).slice(0, 300));

    return {
      ...(input.runId ? { runId: input.runId } : {}),
      stage: input.stage,
      error: input.error,
      rolledBack: input.rolledBack,
      ...(input.restoredSnapshot !== undefined ? { restoredSnapshot: input.restoredSnapshot } : {}),
      nextSteps: input.error.remediation ?? remediationFor(input.error.code, context),
      logExcerpt: lines.join('\n'),
    };
  }
}
