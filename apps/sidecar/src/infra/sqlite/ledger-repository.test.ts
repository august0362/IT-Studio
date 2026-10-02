import { describe, expect, it } from 'vitest';
import { createFakeIdGenerator } from '../../infra/id.js';
import {
  isoDateTimeSchema,
  ledgerEntryIdSchema,
  microUsdSchema,
  pipelineRunIdSchema,
  projectIdSchema,
} from '../../validation/brand.js';
import { priceTableVersionSchema } from '../../validation/common.js';
import { openDatabase } from './database.js';
import { LedgerRepository } from './ledger-repository.js';
import { ProjectRepository } from './project-repository.js';

describe('LedgerRepository', () => {
  it('TC-M3-051 paginates 250 rows without duplicates, gaps, or order changes', async () => {
    const database = openDatabase(':memory:');
    const projects = new ProjectRepository(database.db);
    const projectId = projectIdSchema.parse('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await projects.create({
      id: projectId,
      name: 'Pagination test',
      workspaceRoot: 'C:/pagination-test',
      createdAt: isoDateTimeSchema.parse('2026-10-02T00:00:00.000Z'),
      archived: false,
    });
    const repository = new LedgerRepository(database.db);
    for (let index = 0; index < 250; index += 1) {
      await repository.insert({
        id: ledgerEntryIdSchema.parse(`dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, '0')}`),
        projectId,
        occurredAt: isoDateTimeSchema.parse('2026-10-02T00:00:00.000Z'),
        purpose: 'chat',
        modelKey: 'openai/test-model',
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
        costMicroUsd: microUsdSchema.parse(index),
        priceTableVersion: priceTableVersionSchema.parse('seed-v1'),
        billedFailure: false,
      });
    }
    const rows: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const cursorText = cursor === undefined ? undefined : Buffer.from(cursor, 'base64url').toString('utf8');
      const separator = cursorText?.indexOf('|') ?? -1;
      const decodedCursor =
        cursorText === undefined || separator < 1
          ? undefined
          : { occurredAt: cursorText.slice(0, separator), id: cursorText.slice(separator + 1) };
      const page = await repository.query({ projectId, limit: 100 }, decodedCursor, 100);
      rows.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
      if (cursor === undefined) break;
    }
    expect(rows).toHaveLength(250);
    expect(new Set(rows).size).toBe(250);
    expect(rows).toEqual([...rows].sort((left, right) => right.localeCompare(left)));
    database.client.close();
  });

  it('sums only rows for the requested pipeline, including billed failures', async () => {
    const database = openDatabase(':memory:');
    const projects = new ProjectRepository(database.db);
    const projectId = projectIdSchema.parse('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await projects.create({
      id: projectId,
      name: 'Ledger test',
      workspaceRoot: 'C:/ledger-test',
      createdAt: isoDateTimeSchema.parse('2026-10-02T00:00:00.000Z'),
      archived: false,
    });
    const repository = new LedgerRepository(database.db);
    const runId = pipelineRunIdSchema.parse('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const otherRunId = pipelineRunIdSchema.parse('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    expect(await repository.sumByPipelineRun(runId)).toBe(0);
    const ids = createFakeIdGenerator([
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
    ]);
    for (const [pipelineRunId, cost, billedFailure] of [
      [runId, 30, false],
      [runId, 12, true],
      [otherRunId, 90, false],
    ] as const) {
      await repository.insert({
        id: ledgerEntryIdSchema.parse(ids.uuid()),
        projectId,
        occurredAt: isoDateTimeSchema.parse('2026-10-02T00:00:00.000Z'),
        purpose: 'pipeline_pm',
        modelKey: 'openai/test-model',
        pipelineRunId,
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
        costMicroUsd: microUsdSchema.parse(cost),
        priceTableVersion: priceTableVersionSchema.parse('seed-v1'),
        billedFailure,
      });
    }
    expect(await repository.sumByPipelineRun(runId)).toBe(42);
    database.client.close();
  });
});
