import { describe, expect, it } from 'vitest';
import { PipelineStage, type PipelineRun, type RpcNotificationMap } from '@itstudio/schemas';
import { createFakeClock } from '../../../kernel/infra/clock.js';
import { EventBus } from '../../../kernel/rpc/event-bus.js';
import { pipelineRunSchema } from '../../../kernel/validation/pipeline.js';
import { FailureReportBuilder } from './failure-report-builder.js';
import { recoverInterruptedRuns } from './pipeline-recovery.js';

const transactionId = '00000000-0000-4000-8000-000000000099';
const base = {
  projectId: '00000000-0000-4000-8000-000000000001',
  prompt: 'Build',
  roleAssignment: { pm: [], coder: [], reviewer: [] },
  coderOutputs: [],
  verdicts: [],
  fixAttempts: 0,
  cost: { microUsd: 0, vnd: 0, usdText: '$0.00', vndText: '0 ₫', fxAsOf: '2026-01-01T00:00:00.000Z' },
  startedAt: '2026-01-01T00:00:00.000Z',
};

describe('startup pipeline recovery', () => {
  it.each([false, true])(
    'QA-BREAK-02-D09 finishes recovered writing runs (transaction persisted=%s)',
    async (persisted) => {
      const run = pipelineRunSchema.parse({
        ...base,
        id: '00000000-0000-4000-8000-000000000002',
        stage: PipelineStage.WRITING,
        ...(persisted ? { transactionId } : {}),
      });
      const stages = [
        'specifying',
        'coding',
        'reviewing',
        'fixing',
        're_reviewing',
        'validating',
        'clarifying',
        'completed',
        'failed',
        'rolled_back',
        'cancelled',
      ];
      const rows = new Map<string, PipelineRun>(
        [
          run,
          ...stages.map((stage, index) =>
            pipelineRunSchema.parse({
              ...base,
              stage,
              id: `00000000-0000-4000-8000-${String(index + 3).padStart(12, '0')}`,
            }),
          ),
        ].map((row) => [row.id, row]),
      );
      const events = new EventBus<RpcNotificationMap>();
      const finished: RpcNotificationMap['pipeline.event'][] = [];
      const reports: RpcNotificationMap['pipeline.failureReport'][] = [];
      events.subscribe('pipeline.event', (event) => finished.push(event));
      events.subscribe('pipeline.failureReport', (report) => reports.push(report));
      const sweep = () =>
        recoverInterruptedRuns({
          projectId: run.projectId,
          recoveredTransactions: new Set([transactionId]),
          events,
          clock: createFakeClock(new Date('2026-01-02T00:00:00.000Z')),
          reports: new FailureReportBuilder(),
          repository: {
            get: (id) => Promise.resolve(rows.get(id) ?? null),
            list: () => Promise.resolve([...rows.values()]),
            save: (row) => {
              rows.set(row.id, row);
              return Promise.resolve();
            },
          },
        });
      await sweep();
      expect(rows.get(run.id)).toMatchObject({
        stage: 'rolled_back',
        finishedAt: '2026-01-02T00:00:00.000Z',
        transactionId,
        failureReport: { runId: run.id, rolledBack: true, restoredSnapshot: transactionId },
      });
      for (const row of rows.values()) {
        if (row.id === run.id || ['clarifying', 'completed', 'cancelled', 'rolled_back'].includes(row.stage)) continue;
        if (row.failureReport !== undefined)
          expect(row).toMatchObject({ stage: 'failed', failureReport: { runId: row.id, rolledBack: false } });
      }
      expect([...rows.values()].find((row) => row.stage === 'clarifying')?.finishedAt).toBeUndefined();
      expect(finished).toHaveLength(7);
      expect(reports).toHaveLength(7);
      expect(finished).toContainEqual({ type: 'finished', runId: run.id, stage: 'rolled_back' });
      await sweep();
      expect(finished).toHaveLength(7);
    },
  );
});
