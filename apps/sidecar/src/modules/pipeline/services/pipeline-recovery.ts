import { ErrorCode, PipelineStage, type ProjectId, type RpcNotificationMap } from '@itstudio/schemas';
import type { IClock } from '../../../kernel/infra/clock.js';
import type { IPipelineRepository } from '../../../kernel/infra/sqlite/pipeline-repository.js';
import type { EventBus } from '../../../kernel/rpc/event-bus.js';
import { isoDateTimeSchema, transactionIdSchema } from '../../../kernel/validation/brand.js';
import type { FailureReportBuilder } from './failure-report-builder.js';

/** Called before accepting starts, so hydration cannot retain an interrupted run's gate. */
export async function recoverInterruptedRuns(input: {
  readonly projectId: ProjectId;
  readonly recoveredTransactions: ReadonlySet<string>;
  readonly repository: IPipelineRepository;
  readonly reports: FailureReportBuilder;
  readonly events: Pick<EventBus<RpcNotificationMap>, 'publish'>;
  readonly clock: IClock;
}): Promise<void> {
  const runs = await input.repository.list(input.projectId, Number.MAX_SAFE_INTEGER);
  const unclaimed = new Set(input.recoveredTransactions);
  for (const run of runs) if (run.transactionId !== undefined) unclaimed.delete(run.transactionId);
  for (const run of runs) {
    if (['completed', 'failed', 'rolled_back', 'cancelled', 'clarifying'].includes(run.stage)) continue;
    // A crash inside prepare occurs before the orchestrator receives the transaction id.
    const transactionId =
      run.transactionId ?? (run.stage === PipelineStage.WRITING ? unclaimed.values().next().value : undefined);
    if (transactionId !== undefined) unclaimed.delete(transactionId);
    const rolledBack = transactionId !== undefined && input.recoveredTransactions.has(transactionId);
    const stage = rolledBack ? PipelineStage.ROLLED_BACK : PipelineStage.FAILED;
    const report = input.reports.build({
      runId: run.id,
      stage: run.stage,
      error: {
        code: ErrorCode.INTERNAL,
        message: 'The pipeline was interrupted by a sidecar restart.',
        retryable: false,
        remediation: ['Review the project files and start the pipeline again.'],
      },
      rolledBack,
      ...(rolledBack ? { restoredSnapshot: transactionId } : {}),
      logLines: ['Recovered an interrupted pipeline during sidecar startup.'],
    });
    await input.repository.save({
      ...run,
      stage,
      ...(transactionId === undefined ? {} : { transactionId: transactionIdSchema.parse(transactionId) }),
      finishedAt: isoDateTimeSchema.parse(input.clock.now().toISOString()),
      failureReport: report,
    });
    input.events.publish('pipeline.event', { type: 'finished', runId: run.id, stage });
    input.events.publish('pipeline.failureReport', report);
  }
}
