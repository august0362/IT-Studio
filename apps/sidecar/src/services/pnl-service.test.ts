import { describe, expect, it } from 'vitest';
import type { LedgerEntry, Project, RevenueEntry } from '@itstudio/schemas';
import type { ILedgerRepository } from '../ports/ledger-repository.js';
import type { IProjectRepository } from '../ports/project-repository.js';
import type { IRevenueRepository } from '../ports/revenue-repository.js';
import {
  isoDateTimeSchema,
  ledgerEntryIdSchema,
  microUsdSchema,
  projectIdSchema,
  revenueEntryIdSchema,
} from '../validation/brand.js';
import { priceTableVersionSchema } from '../validation/common.js';
import { PnLService } from './pnl-service.js';

const projectAId = projectIdSchema.parse('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const projectBId = projectIdSchema.parse('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const from = isoDateTimeSchema.parse('2026-10-01T00:00:00.000Z');
const to = isoDateTimeSchema.parse('2026-10-03T00:00:00.000Z');
const fx = { usdToVnd: 25_000, asOf: to, source: 'auto' as const };

function project(id: typeof projectAId): Project {
  return { id, name: 'Project', workspaceRoot: `C:/${id}`, createdAt: from, archived: false };
}

function entry(id: string, projectId: typeof projectAId, occurredAt: string, costMicroUsd: number): LedgerEntry {
  return {
    id: ledgerEntryIdSchema.parse(id),
    projectId,
    occurredAt: isoDateTimeSchema.parse(occurredAt),
    purpose: 'chat',
    modelKey: 'openai/test-model',
    usage: { inputTokens: 3, outputTokens: 2, cachedInputTokens: 0 },
    costMicroUsd: microUsdSchema.parse(costMicroUsd),
    priceTableVersion: priceTableVersionSchema.parse('seed-v1'),
    billedFailure: false,
  };
}

describe('PnLService', () => {
  it('formats exclusive-range project and portfolio totals, including inactive projects', async () => {
    const ledgerRows = [
      entry('cccccccc-cccc-4ccc-8ccc-cccccccccccc', projectAId, '2026-10-01T12:00:00.000Z', 6),
      entry('dddddddd-dddd-4ddd-8ddd-dddddddddddd', projectAId, to, 100),
      entry('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', projectBId, '2026-10-02T12:00:00.000Z', 3),
    ];
    const revenues: RevenueEntry[] = [
      {
        id: revenueEntryIdSchema.parse('ffffffff-ffff-4fff-8fff-ffffffffffff'),
        projectId: projectAId,
        occurredAt: '2026-10-01T09:00:00.000Z' as RevenueEntry['occurredAt'],
        amountMicroUsd: microUsdSchema.parse(4),
        enteredCurrency: 'USD',
        description: '',
      },
    ];
    const projects: IProjectRepository = {
      list: () => Promise.resolve([project(projectAId), project(projectBId)]),
      get: (id) =>
        Promise.resolve(id === projectAId ? project(projectAId) : id === projectBId ? project(projectBId) : null),
      getByWorkspaceRoot: () => Promise.resolve(null),
      create: () => Promise.resolve(),
      setArchived: () => Promise.resolve(false),
    };
    const ledger: ILedgerRepository = {
      insert: () => Promise.resolve(),
      sumByPipelineRun: () => Promise.resolve(microUsdSchema.parse(0)),
      query: (query) =>
        Promise.resolve({
          items: ledgerRows.filter((row) => row.projectId === query.projectId && row.occurredAt >= from),
          nextCursor: null,
        }),
    };
    const revenue: IRevenueRepository = {
      insert: () => Promise.resolve(),
      list: ({ projectId }) => Promise.resolve(revenues.filter((row) => row.projectId === projectId)),
    };
    const service = new PnLService({ ledger, revenue, projects, fx: { getFxRate: () => fx } });
    const projectResult = await service.get(projectAId, from, to);
    expect(projectResult).toMatchObject({
      ok: true,
      value: { revenue: { microUsd: 4 }, cost: { microUsd: 6 }, margin: { microUsd: -2 } },
    });
    const all = await service.getAll(from, to);
    expect(all).toMatchObject({
      ok: true,
      value: {
        revenue: { microUsd: 4 },
        cost: { microUsd: 9 },
        margin: { microUsd: -5 },
        projects: [{ projectId: projectBId }, { projectId: projectAId }],
        byProject: [
          { key: projectAId, cost: { microUsd: 6 } },
          { key: projectBId, cost: { microUsd: 3 } },
        ],
      },
    });
    expect(await service.get(projectAId, to, to)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});
