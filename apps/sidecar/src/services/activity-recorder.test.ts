import {
  ErrorCode,
  WorkflowModuleId,
  type ActivityEvent,
  type AppSettings,
  type MoneyDisplay,
  type Result,
  type RpcNotificationMap,
} from '@itstudio/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  llmRequestIdSchema,
  projectIdSchema,
  pipelineRunIdSchema,
  ingestJobIdSchema,
  commandRunIdSchema,
  conversationIdSchema,
  messageIdSchema,
  ledgerEntryIdSchema,
  priceTableVersionSchema,
  microUsdSchema,
  isoDateTimeSchema,
} from '../validation/brand.js';
import { chatMessageSchema } from '../validation/chat.js';
import { ledgerEntrySchema, moneyDisplaySchema } from '../validation/cost.js';
import { workspaceRelativePathSchema } from '../validation/common.js';
import { mapWorkflowEvent } from './activity-recorder.js';
import { ActivityRecorder } from './activity-recorder.js';
import { EventBus } from '../rpc/event-bus.js';
import { createFakeClock } from '../infra/clock.js';
import type { SettingsService } from './settings-service.js';

const projectId = projectIdSchema.parse('00000000-0000-4000-8000-000000000001');
const requestId = llmRequestIdSchema.parse('00000000-0000-4000-8000-000000000002');
const fxAsOf = '2026-01-01T00:00:00.000Z';
const runId = pipelineRunIdSchema.parse('00000000-0000-4000-8000-000000000003');
const conversationId = conversationIdSchema.parse('00000000-0000-4000-8000-000000000005');
const keyLikeString = ['sk', '123456789012345678901234567890'].join('-');
const promptAndKey = ['user prompt: hidden content', keyLikeString].join(' ');
const money = moneyDisplaySchema.parse({ microUsd: 5, vnd: 1, usdText: '$0.000005', vndText: '1 ₫', fxAsOf });
const settingsFailure: Result<AppSettings> = {
  ok: false,
  error: { code: ErrorCode.INTERNAL, message: 'settings unavailable', retryable: false, remediation: ['Retry.'] },
};

afterEach(() => vi.useRealTimers());

describe('ActivityRecorder correlations', () => {
  it.each(['before', 'after'] as const)(
    'assigns request and pipeline activity when mappings are known %s events',
    async (order) => {
      const events = new EventBus<RpcNotificationMap>();
      const stored: ActivityEvent[] = [];
      let generated = 0;
      const recorder = new ActivityRecorder({
        events,
        repository: {
          insert: (event) => {
            stored.push(event);
            return Promise.resolve();
          },
          query: () => stored,
          since: () => stored,
          prune: () => undefined,
        },
        ids: { uuid: () => `00000000-0000-4000-8000-${String(++generated).padStart(12, '0')}` },
        clock: createFakeClock(new Date(fxAsOf)),
        settings: { get: (): Promise<Result<AppSettings>> => Promise.resolve(settingsFailure) } satisfies Pick<
          SettingsService,
          'get'
        >,
        aggregateCost: (amount): MoneyDisplay =>
          moneyDisplaySchema.parse({ microUsd: amount, vnd: amount, usdText: '$0', vndText: '0 â‚«', fxAsOf }),
        vscodeBridgeAvailable: false,
      });
      const publish = (): void => {
        events.publish('chat.delta', { requestId, textDelta: 'private response' });
        events.publish('router.event', { type: 'state', requestId, state: 'dispatching' });
        events.publish('pipeline.event', { type: 'stage', runId, stage: 'specifying' });
      };
      const correlate = (): void => {
        recorder.correlateRequest(requestId, { projectId, conversationId });
        recorder.correlatePipelineRun(runId, projectId);
      };
      if (order === 'before') publish();
      correlate();
      if (order === 'after') publish();
      await vi.waitFor(() => {
        expect(stored).toHaveLength(3);
      });
      expect(stored.map((event) => event.projectId)).toEqual([projectId, projectId, projectId]);
      expect(stored.find((event) => event.moduleId === WorkflowModuleId.CHAT)?.refs.conversationId).toBe(
        conversationId,
      );
      expect(stored.find((event) => event.moduleId === WorkflowModuleId.ROUTER)?.refs.conversationId).toBe(
        conversationId,
      );
      expect(stored.find((event) => event.refs.pipelineRunId === runId)?.moduleId).toBe(WorkflowModuleId.PIPELINE_PM);
      recorder.stop();
    },
  );
});

describe('mapWorkflowEvent', () => {
  it.each([
    [
      'router start',
      { name: 'router.event', payload: { type: 'state', requestId, state: 'dispatching' } },
      WorkflowModuleId.ROUTER,
      'started',
    ],
    [
      'chat delta',
      { name: 'chat.delta', payload: { requestId, textDelta: 'user prompt and response must stay private' } },
      WorkflowModuleId.CHAT,
      'progress',
    ],
    [
      'chat failure',
      {
        name: 'chat.failed',
        payload: {
          requestId,
          error: {
            code: ErrorCode.INTERNAL,
            message: promptAndKey,
            retryable: false,
            remediation: ['retry'],
          },
        },
      },
      WorkflowModuleId.CHAT,
      'failed',
    ],
    [
      'pipeline stage',
      {
        name: 'pipeline.event',
        payload: {
          type: 'stage',
          runId: pipelineRunIdSchema.parse('00000000-0000-4000-8000-000000000003'),
          stage: 'specifying',
        },
      },
      WorkflowModuleId.PIPELINE_PM,
      'started',
    ],
    [
      'rag progress',
      {
        name: 'rag.progress',
        payload: {
          id: ingestJobIdSchema.parse('00000000-0000-4000-8000-000000000004'),
          projectId,
          paths: ['private document text'],
          status: 'embedding',
          processedFiles: 1,
          totalFiles: 2,
          cost: microUsdSchema.parse(0),
        },
      },
      WorkflowModuleId.RAG_INGEST,
      'progress',
    ],
    [
      'router streaming provider',
      {
        name: 'router.event',
        payload: { type: 'state', requestId, state: 'streaming', modelKey: 'google/gemini-3.8-flash' },
      },
      WorkflowModuleId.PROVIDERS,
      'started',
    ],
    [
      'router terminal success',
      { name: 'router.event', payload: { type: 'state', requestId, state: 'succeeded' } },
      WorkflowModuleId.ROUTER,
      'completed',
    ],
    [
      'router fallback',
      {
        name: 'router.event',
        payload: {
          type: 'fallback',
          requestId,
          from: 'google/gemini-3.8-flash',
          to: 'groq/llama-3.3-70b-versatile',
          reason: 'rate_limited',
        },
      },
      WorkflowModuleId.ROUTER,
      'progress',
    ],
    [
      'router failed attempt',
      {
        name: 'router.event',
        payload: {
          type: 'attempt_failed',
          requestId,
          attempt: {
            modelKey: 'google/gemini-3.8-flash',
            startedAt: isoDateTimeSchema.parse(fxAsOf),
            latencyMs: 12,
            outcome: 'failed',
            failure: 'timeout',
          },
        },
      },
      WorkflowModuleId.ROUTER,
      'progress',
    ],
    [
      'router circuit',
      { name: 'router.event', payload: { type: 'circuit', modelKey: 'google/gemini-3.8-flash', status: 'open' } },
      WorkflowModuleId.ROUTER,
      'progress',
    ],
    [
      'chat completion',
      {
        name: 'chat.completed',
        payload: {
          requestId,
          message: chatMessageSchema.parse({
            id: messageIdSchema.parse('00000000-0000-4000-8000-000000000006'),
            conversationId,
            role: 'assistant',
            parts: [],
            createdAt: fxAsOf,
          }),
          cost: money,
        },
      },
      WorkflowModuleId.CHAT,
      'completed',
    ],
    [
      'pipeline artifact',
      { name: 'pipeline.event', payload: { type: 'artifact', runId, kind: 'code', index: 0 } },
      WorkflowModuleId.WORKER,
      'progress',
    ],
    [
      'pipeline command output',
      {
        name: 'pipeline.event',
        payload: {
          type: 'command_output',
          runId,
          commandRunId: commandRunIdSchema.parse('00000000-0000-4000-8000-000000000007'),
          stream: 'stdout',
          chunk: 'private command output',
        },
      },
      WorkflowModuleId.WORKER,
      'progress',
    ],
    [
      'pipeline finished',
      { name: 'pipeline.event', payload: { type: 'finished', runId, stage: 'completed' } },
      WorkflowModuleId.WORKER,
      'completed',
    ],
    [
      'pipeline failure report',
      {
        name: 'pipeline.failureReport',
        payload: {
          runId,
          stage: 'rolled_back',
          error: { code: ErrorCode.INTERNAL, message: 'private prompt', retryable: false, remediation: ['Retry.'] },
          rolledBack: true,
          nextSteps: ['Review changes.'],
          logExcerpt: 'private output',
        },
      },
      WorkflowModuleId.WORKER,
      'failed',
    ],
    [
      'rag completion',
      {
        name: 'rag.progress',
        payload: {
          id: ingestJobIdSchema.parse('00000000-0000-4000-8000-000000000004'),
          projectId,
          paths: [],
          status: 'indexed',
          processedFiles: 2,
          totalFiles: 2,
          cost: microUsdSchema.parse(0),
        },
      },
      WorkflowModuleId.RAG_INGEST,
      'completed',
    ],
    [
      'ledger entry',
      {
        name: 'ledger.entry',
        payload: {
          entry: ledgerEntrySchema.parse({
            id: ledgerEntryIdSchema.parse('00000000-0000-4000-8000-000000000008'),
            projectId,
            occurredAt: fxAsOf,
            purpose: 'chat',
            modelKey: 'google/gemini-3.8-flash',
            llmRequestId: requestId,
            conversationId,
            usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
            costMicroUsd: 5,
            priceTableVersion: priceTableVersionSchema.parse('test'),
            billedFailure: false,
          }),
          cost: money,
        },
      },
      WorkflowModuleId.LEDGER,
      'completed',
    ],
    [
      'budget alert',
      {
        name: 'budget.alert',
        payload: {
          budget: { projectId, period: 'daily', limitMicroUsd: microUsdSchema.parse(10), warnAt: [0.5] },
          spent: money,
          remaining: money,
          fractionUsed: 0.5,
          level: 'warning',
          blocking: false,
        },
      },
      WorkflowModuleId.BUDGET_GUARD,
      'info',
    ],
    [
      'pricing update',
      {
        name: 'pricing.updated',
        payload: {
          startedAt: isoDateTimeSchema.parse(fxAsOf),
          finishedAt: isoDateTimeSchema.parse(fxAsOf),
          status: 'applied',
          deltas: [],
        },
      },
      WorkflowModuleId.PRICING_FX,
      'completed',
    ],
    [
      'VS Code connection status',
      { name: 'vscode.status', payload: { installed: true, extensionInstalled: true, connected: true } },
      WorkflowModuleId.VSCODE_BRIDGE,
      'info',
    ],
    [
      'VS Code diagnostics',
      {
        name: 'vscode.diagnostics',
        payload: {
          projectId,
          diagnostics: [
            {
              source: 'tsc',
              severity: 'error',
              path: workspaceRelativePathSchema.parse('src/a.ts'),
              line: 1,
              column: 1,
              message: promptAndKey,
            },
          ],
        },
      },
      WorkflowModuleId.VSCODE_BRIDGE,
      'failed',
    ],
  ] as const)('%s maps to its module and activity kind', (_name, source, moduleId, kind) => {
    const mapped = mapWorkflowEvent(source, projectId);
    expect(mapped).toMatchObject({ moduleId, kind });
  });

  it('does not include prompt text or API key like strings in activity summaries', () => {
    const source = {
      name: 'chat.failed' as const,
      payload: {
        requestId,
        error: {
          code: ErrorCode.INTERNAL,
          message: promptAndKey,
          retryable: false,
          remediation: ['retry'],
        },
      },
    };
    const mapped = mapWorkflowEvent(source, projectId);
    expect(mapped.summary).not.toContain('hidden content');
    expect(mapped.summary).not.toMatch(new RegExp(['sk', '-', '[A-Za-z0-9_-]{20,}'].join('')));
  });

  it('keeps a mixed prompt and key corpus out of chat, pipeline, RAG, and diagnostic summaries', () => {
    const corpus = [
      mapWorkflowEvent(
        {
          name: 'chat.failed',
          payload: {
            requestId,
            error: { code: ErrorCode.INTERNAL, message: promptAndKey, retryable: false, remediation: ['Retry.'] },
          },
        },
        projectId,
      ),
      mapWorkflowEvent(
        {
          name: 'pipeline.failureReport',
          payload: {
            runId,
            stage: 'failed',
            error: { code: ErrorCode.INTERNAL, message: promptAndKey, retryable: false, remediation: ['Retry.'] },
            rolledBack: false,
            nextSteps: [],
            logExcerpt: promptAndKey,
          },
        },
        projectId,
      ),
      mapWorkflowEvent(
        {
          name: 'vscode.diagnostics',
          payload: {
            projectId,
            diagnostics: [
              {
                source: 'tsc',
                severity: 'error',
                path: workspaceRelativePathSchema.parse('src/a.ts'),
                line: 1,
                column: 1,
                message: promptAndKey,
              },
            ],
          },
        },
        projectId,
      ),
    ];
    for (const event of corpus) {
      expect(event.summary).not.toContain('hidden content');
      expect(event.summary).not.toContain(keyLikeString);
    }
  });

  it('batches notifications and opens then closes chat in-flight state', async () => {
    vi.useFakeTimers();
    const events = new EventBus<RpcNotificationMap>();
    const stored: ActivityEvent[] = [];
    const repository = {
      insert: (event: ActivityEvent) => {
        stored.push(event);
        return Promise.resolve();
      },
      query: () => stored,
      since: () => stored,
      prune: () => undefined,
    };
    let generated = 0;
    const recorder = new ActivityRecorder({
      events,
      repository,
      ids: { uuid: () => `00000000-0000-4000-8000-${String(++generated).padStart(12, '0')}` },
      clock: createFakeClock(new Date(fxAsOf)),
      settings: { get: (): Promise<Result<AppSettings>> => Promise.resolve(settingsFailure) } satisfies Pick<
        SettingsService,
        'get'
      >,
      aggregateCost: (amount): MoneyDisplay =>
        moneyDisplaySchema.parse({ microUsd: amount, vnd: amount, usdText: '$0', vndText: '0 ₫', fxAsOf }),
      vscodeBridgeAvailable: false,
    });
    const received: ActivityEvent[][] = [];
    events.subscribe('workflow.activity', (batch) => received.push([...batch]));
    recorder.correlateRequest(requestId, { projectId, conversationId });
    events.publish('chat.delta', { requestId, textDelta: 'first private chunk' });
    events.publish('chat.delta', { requestId, textDelta: 'second private chunk' });
    await vi.advanceTimersByTimeAsync(0);
    const active = await recorder.graph(null);
    expect(active.nodes.find((node) => node.id === WorkflowModuleId.CHAT)).toMatchObject({
      status: 'active',
      inFlight: 1,
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(2);
    events.publish('chat.failed', {
      requestId,
      error: { code: ErrorCode.INTERNAL, message: 'response failed', retryable: false, remediation: ['Retry.'] },
    });
    await vi.advanceTimersByTimeAsync(0);
    const idle = await recorder.graph(null);
    expect(idle.nodes.find((node) => node.id === WorkflowModuleId.CHAT)).toMatchObject({
      status: 'error',
      inFlight: 0,
    });
    recorder.stop();
  });
});
