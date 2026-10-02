import type { CostPurpose, MicroUsd, ProjectId, TokenUsage } from '@itstudio/schemas';
import { microUsd, sumMicroUsd } from './money.js';

export interface PnLRevenueRow {
  readonly occurredAt: string;
  readonly amountMicroUsd: MicroUsd;
}

export interface PnLLedgerRow {
  readonly occurredAt: string;
  readonly purpose: CostPurpose;
  readonly modelKey: string;
  readonly usage: TokenUsage;
  readonly costMicroUsd: MicroUsd;
}

export interface PnLProjectRows {
  readonly projectId: ProjectId;
  readonly revenue: readonly PnLRevenueRow[];
  readonly ledger: readonly PnLLedgerRow[];
}

export interface PnLAggregate {
  readonly revenueMicroUsd: MicroUsd;
  readonly costMicroUsd: MicroUsd;
  readonly marginMicroUsd: MicroUsd;
  readonly marginPercent: number | null;
  readonly byModel: readonly PnLCostBreakdown[];
  readonly byPurpose: readonly PnLCostBreakdown[];
  readonly byDay: readonly PnLCostBreakdown[];
}

export interface PnLCostBreakdown {
  readonly key: string;
  readonly costMicroUsd: MicroUsd;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly requestCount: number;
}

export interface PortfolioAggregate extends PnLAggregate {
  readonly projects: readonly { readonly projectId: ProjectId; readonly aggregate: PnLAggregate }[];
  readonly byProject: readonly PnLCostBreakdown[];
}

interface BreakdownAccumulator {
  cost: MicroUsd[];
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
}

export function aggregateProject(rows: PnLProjectRows): PnLAggregate {
  return aggregateRows(rows.revenue, rows.ledger);
}

export function aggregatePortfolio(rows: readonly PnLProjectRows[]): PortfolioAggregate {
  const projects = rows.map((project) => ({ project, aggregate: aggregateProject(project) }));
  const revenueMicroUsd = sumMicroUsd(projects.map((project) => project.aggregate.revenueMicroUsd));
  const costMicroUsd = sumMicroUsd(projects.map((project) => project.aggregate.costMicroUsd));
  const allLedger = rows.flatMap((project) => project.ledger);
  const allRevenue = rows.flatMap((project) => project.revenue);
  const combined = aggregateRows(allRevenue, allLedger);
  const byProject = projects
    .map(({ project, aggregate }) => ({
      key: project.projectId,
      costMicroUsd: aggregate.costMicroUsd,
      inputTokens: sumTokens(project.ledger, 'input'),
      outputTokens: sumTokens(project.ledger, 'output'),
      requestCount: project.ledger.length,
    }))
    .sort((left, right) => right.costMicroUsd - left.costMicroUsd || left.key.localeCompare(right.key))
    .map((row) => ({
      key: row.key,
      costMicroUsd: row.costMicroUsd,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      requestCount: row.requestCount,
    }));
  return {
    ...combined,
    revenueMicroUsd,
    costMicroUsd,
    marginMicroUsd: microUsd(revenueMicroUsd - costMicroUsd),
    projects: projects.map(({ project, aggregate }) => ({ projectId: project.projectId, aggregate })),
    byProject,
  };
}

function aggregateRows(revenue: readonly PnLRevenueRow[], ledger: readonly PnLLedgerRow[]): PnLAggregate {
  const revenueMicroUsd = sumMicroUsd(revenue.map((row) => row.amountMicroUsd));
  const costMicroUsd = sumMicroUsd(ledger.map((row) => row.costMicroUsd));
  const marginMicroUsd = microUsd(revenueMicroUsd - costMicroUsd);
  return {
    revenueMicroUsd,
    costMicroUsd,
    marginMicroUsd,
    marginPercent: revenueMicroUsd === 0 ? null : roundPercent(marginMicroUsd / revenueMicroUsd),
    byModel: breakdown(ledger, (row) => row.modelKey),
    byPurpose: breakdown(ledger, (row) => row.purpose),
    byDay: breakdown(ledger, (row) => row.occurredAt.slice(0, 10), true),
  };
}

function breakdown(
  rows: readonly PnLLedgerRow[],
  keyOf: (row: PnLLedgerRow) => string,
  ascending = false,
): PnLCostBreakdown[] {
  const groups = new Map<string, BreakdownAccumulator>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? { cost: [], inputTokens: 0, outputTokens: 0, requestCount: 0 };
    group.cost.push(row.costMicroUsd);
    group.inputTokens += row.usage.inputTokens;
    group.outputTokens += row.usage.outputTokens;
    group.requestCount += 1;
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      costMicroUsd: sumMicroUsd(group.cost),
      inputTokens: group.inputTokens,
      outputTokens: group.outputTokens,
      requestCount: group.requestCount,
    }))
    .sort((left, right) =>
      ascending
        ? left.key.localeCompare(right.key)
        : right.costMicroUsd - left.costMicroUsd || left.key.localeCompare(right.key),
    )
    .map(({ key, costMicroUsd, inputTokens, outputTokens, requestCount }) => ({
      key,
      costMicroUsd,
      inputTokens,
      outputTokens,
      requestCount,
    }));
}

function sumTokens(rows: readonly PnLLedgerRow[], kind: 'input' | 'output'): number {
  return rows.reduce((sum, row) => sum + (kind === 'input' ? row.usage.inputTokens : row.usage.outputTokens), 0);
}

function roundPercent(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
