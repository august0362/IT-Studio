import { describe, expect, it } from 'vitest';
import { aggregatePortfolio, aggregateProject, type PnLProjectRows } from './pnl.js';
import { microUsdSchema, projectIdSchema } from '../validation/brand.js';

const projectA = projectIdSchema.parse('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const projectB = projectIdSchema.parse('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const projectC = projectIdSchema.parse('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
const projectD = projectIdSchema.parse('dddddddd-dddd-4ddd-8ddd-dddddddddddd');

function rows(
  projectId: PnLProjectRows['projectId'],
  revenue: number,
  entries: PnLProjectRows['ledger'],
): PnLProjectRows {
  return {
    projectId,
    revenue:
      revenue === 0 ? [] : [{ occurredAt: '2026-10-01T00:00:00.000Z', amountMicroUsd: microUsdSchema.parse(revenue) }],
    ledger: entries,
  };
}

function ledger(
  occurredAt: string,
  purpose: PnLProjectRows['ledger'][number]['purpose'],
  modelKey: string,
  cost: number,
  inputTokens = 2,
  outputTokens = 1,
): PnLProjectRows['ledger'][number] {
  return {
    occurredAt,
    purpose,
    modelKey,
    costMicroUsd: microUsdSchema.parse(cost),
    usage: { inputTokens, outputTokens, cachedInputTokens: 0 },
  };
}

describe('P&L aggregation', () => {
  it('TC-M3-041 computes range totals including UTC midnight and exclusive end boundaries', () => {
    const data = rows(projectA, 5, [
      ledger('2026-10-01T23:59:59.999Z', 'chat', 'model/a', 4),
      ledger('2026-10-02T00:00:00.000Z', 'embedding', 'model/b', 3),
      ledger('2026-10-03T12:00:00.000Z', 'chat', 'model/c', 2),
      ledger('2026-10-03T12:30:00.000Z', 'chat', 'model/d', 2),
      ledger('2026-10-03T13:00:00.000Z', 'pipeline_pm', 'model/a', 1),
    ]);
    const result = aggregateProject(data);
    expect(result).toMatchObject({
      revenueMicroUsd: 5,
      costMicroUsd: 12,
      marginMicroUsd: -7,
      marginPercent: -1.4,
      byModel: [
        { key: 'model/a', costMicroUsd: 5, requestCount: 2 },
        { key: 'model/b', costMicroUsd: 3, requestCount: 1 },
        { key: 'model/c', costMicroUsd: 2, requestCount: 1 },
        { key: 'model/d', costMicroUsd: 2, requestCount: 1 },
      ],
      byPurpose: [
        { key: 'chat', costMicroUsd: 8 },
        { key: 'embedding', costMicroUsd: 3 },
        { key: 'pipeline_pm', costMicroUsd: 1 },
      ],
      byDay: [
        { key: '2026-10-01', costMicroUsd: 4 },
        { key: '2026-10-02', costMicroUsd: 3 },
        { key: '2026-10-03', costMicroUsd: 5 },
      ],
    });
  });

  it('TC-M3-042 returns negative margin and null percent for zero revenue', () => {
    const zeroRevenue = rows(projectA, 0, [ledger('2026-10-01T00:00:00.000Z', 'chat', 'model/a', 8)]);
    const profitable = rows(projectB, 20, [ledger('2026-10-02T00:00:00.000Z', 'pipeline_coder', 'model/b', 5)]);
    const empty = rows(projectC, 0, []);
    const alsoEmpty = rows(projectD, 0, []);
    const zeroProject = aggregateProject(zeroRevenue);
    const portfolio = aggregatePortfolio([zeroRevenue, profitable, empty, alsoEmpty]);
    expect(zeroProject.marginPercent).toBeNull();
    expect(portfolio).toMatchObject({
      revenueMicroUsd: 20,
      costMicroUsd: 13,
      marginMicroUsd: 7,
      marginPercent: 0.35,
      projects: [
        { projectId: projectA, aggregate: { costMicroUsd: 8, revenueMicroUsd: 0 } },
        { projectId: projectB, aggregate: { costMicroUsd: 5, revenueMicroUsd: 20 } },
        { projectId: projectC, aggregate: { costMicroUsd: 0, revenueMicroUsd: 0 } },
        { projectId: projectD, aggregate: { costMicroUsd: 0, revenueMicroUsd: 0 } },
      ],
      byProject: [
        { key: projectA, costMicroUsd: 8 },
        { key: projectB, costMicroUsd: 5 },
        { key: projectC, costMicroUsd: 0 },
        { key: projectD, costMicroUsd: 0 },
      ],
    });
  });
});
