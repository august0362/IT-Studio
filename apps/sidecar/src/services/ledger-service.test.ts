import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { LedgerEntry, PriceTable, RpcNotificationMap } from '@itstudio/schemas';
import type { RouterCompleted } from './llm-router.js';
import { createFakeClock } from '../infra/clock.js';
import { createLogger } from '../infra/logger.js';
import { EventBus } from '../rpc/event-bus.js';
import type { ILedgerRepository } from '../ports/ledger-repository.js';
import { LedgerRepository } from '../infra/sqlite/ledger-repository.js';
import {
  conversationIdSchema,
  isoDateTimeSchema,
  llmRequestIdSchema,
  messageIdSchema,
  microUsdSchema,
  projectIdSchema,
  pipelineRunIdSchema,
} from '../validation/brand.js';
import { priceTableVersionSchema } from '../validation/common.js';
import { LedgerService } from './ledger-service.js';

const now = isoDateTimeSchema.parse('2026-10-02T00:00:00.000Z');
const projectId = projectIdSchema.parse('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const table: PriceTable = {
  version: priceTableVersionSchema.parse('seed-v1'),
  effectiveFrom: now,
  origin: 'seed',
  entries: [
    {
      modelKey: 'openai/test-model',
      inputPerMTokMicroUsd: microUsdSchema.parse(1_000_000),
      outputPerMTokMicroUsd: microUsdSchema.parse(2_000_000),
      cachedInputPerMTokMicroUsd: microUsdSchema.parse(500_000),
      freeTier: false,
      sourceUrl: 'https://example.invalid/pricing',
    },
  ],
};

function harness() {
  const rows: LedgerEntry[] = [];
  const warnings: unknown[] = [];
  const prices: { current: PriceTable } = { current: table };
  const repository: ILedgerRepository = {
    insert: (entry) => {
      rows.push(entry);
      return Promise.resolve();
    },
    query: () => Promise.resolve({ items: rows, nextCursor: null }),
    sumByPipelineRun: () => Promise.resolve(microUsdSchema.parse(0)),
  };
  const completed = new EventBus<{ completed: RouterCompleted }>();
  const events = new EventBus<RpcNotificationMap>();
  const logger = createLogger({ streams: [new PassThrough()] });
  const service = new LedgerService({
    repository,
    prices: {
      getPriceTable: () => prices.current,
      getFxRate: () => ({ usdToVnd: 25_000, asOf: now, source: 'auto' }),
    },
    completed,
    events,
    ids: { uuid: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    clock: createFakeClock(new Date(now)),
    logger: {
      ...logger,
      warn: (obj: unknown) => warnings.push(obj),
    },
  });
  return { service, completed, events, rows, warnings, prices };
}

describe('LedgerService', () => {
  it('exposes only insert and query persistence operations', () => {
    expect(Object.getOwnPropertyNames(LedgerRepository.prototype).sort()).toEqual([
      'constructor',
      'insert',
      'query',
      'sumByPipelineRun',
    ]);
  });

  it('freezes the current price, attributes a chat request, and publishes one ledger entry', async () => {
    const { service, completed, events, rows, prices } = harness();
    const published: unknown[] = [];
    events.subscribe('ledger.entry', (item) => published.push(item));
    const requestId = llmRequestIdSchema.parse('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    service.trackRequest({
      id: requestId,
      projectId,
      purpose: 'chat',
      messages: [
        {
          id: messageIdSchema.parse('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
          conversationId: conversationIdSchema.parse('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
          role: 'user',
          parts: [],
          createdAt: now,
        },
      ],
      requiredCapabilities: [],
      stream: true,
    });
    completed.publish('completed', {
      requestId,
      projectId,
      purpose: 'chat',
      modelKey: 'openai/test-model',
      usage: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 20 },
      billedFailure: false,
    });
    prices.current = {
      ...table,
      version: priceTableVersionSchema.parse('seed-v2'),
      entries: table.entries.map((entry) => ({
        ...entry,
        inputPerMTokMicroUsd: microUsdSchema.parse(9_000_000),
      })),
    };
    const recordedCost = await service.recordedCost(requestId);
    await Promise.resolve();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.costMicroUsd).toBe(110);
    expect(rows[0]?.conversationId).toBe('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    expect(rows[0]?.priceTableVersion).toBe('seed-v1');
    expect(recordedCost?.microUsd).toBe(110);
    expect(published).toHaveLength(1);
  });

  it('records billed failures and warns once when a model has no price', async () => {
    const { completed, rows, warnings } = harness();
    for (const requestId of [
      llmRequestIdSchema.parse('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      llmRequestIdSchema.parse('ffffffff-ffff-4fff-8fff-ffffffffffff'),
    ]) {
      completed.publish('completed', {
        requestId,
        projectId,
        purpose: 'chat',
        modelKey: 'openai/unpriced',
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
        billedFailure: true,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rows.map((row) => row.billedFailure)).toEqual([true, true]);
    expect(rows.map((row) => row.costMicroUsd)).toEqual([0, 0]);
    expect(warnings).toHaveLength(1);
  });

  it('persists pipeline attribution from a completed event, including billed failures', async () => {
    const { completed, rows } = harness();
    const pipelineRunId = pipelineRunIdSchema.parse('99999999-9999-4999-8999-999999999999');
    completed.publish('completed', {
      requestId: llmRequestIdSchema.parse('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      projectId,
      purpose: 'pipeline_pm',
      modelKey: 'openai/test-model',
      pipelineRunId,
      usage: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 0 },
      billedFailure: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rows[0]).toMatchObject({ pipelineRunId, billedFailure: true });
  });
});
