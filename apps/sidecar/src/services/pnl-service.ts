import {
  ErrorCode,
  type AppError,
  type FxRate,
  type IsoDateTime,
  type LedgerEntry,
  type MoneyDisplay,
  type PortfolioPnL,
  type ProjectId,
  type ProjectPnL,
  type Result,
} from '@itstudio/schemas';
import type { ILedgerRepository } from '../ports/ledger-repository.js';
import type { IProjectRepository } from '../ports/project-repository.js';
import type { IRevenueRepository } from '../ports/revenue-repository.js';
import type { PnLLedgerRow, PnLProjectRows, PnLRevenueRow } from '../domain/pnl.js';
import { aggregatePortfolio, aggregateProject } from '../domain/pnl.js';
import { toMoneyDisplay } from '../domain/money.js';
import { signedMicroUsdSchema } from '../validation/brand.js';

export interface PnLServiceDependencies {
  readonly ledger: ILedgerRepository;
  readonly revenue: IRevenueRepository;
  readonly projects: IProjectRepository;
  readonly fx: { getFxRate(): FxRate };
}

export class PnLService {
  private readonly deps: PnLServiceDependencies;

  constructor(dependencies: PnLServiceDependencies) {
    this.deps = dependencies;
  }

  async get(projectId: ProjectId, from: IsoDateTime, to: IsoDateTime): Promise<Result<ProjectPnL>> {
    const rangeError = validateRange(from, to);
    if (rangeError !== null) return rangeError;
    if ((await this.deps.projects.get(projectId)) === null)
      return failure(ErrorCode.NOT_FOUND, 'Project was not found.');
    const rows = await this.projectRows(projectId, from, to);
    return { ok: true, value: this.formatProject(projectId, from, to, aggregateProject(rows)) };
  }

  async getAll(from: IsoDateTime, to: IsoDateTime): Promise<Result<PortfolioPnL>> {
    const rangeError = validateRange(from, to);
    if (rangeError !== null) return rangeError;
    const projects = await this.deps.projects.list();
    const rows = await Promise.all(projects.map((project) => this.projectRows(project.id, from, to)));
    const aggregate = aggregatePortfolio(rows);
    const formattedProjects = aggregate.projects
      .map(({ projectId, aggregate: projectAggregate }) => this.formatProject(projectId, from, to, projectAggregate))
      .sort(
        (left, right) => left.margin.microUsd - right.margin.microUsd || left.projectId.localeCompare(right.projectId),
      );
    return {
      ok: true,
      value: {
        from,
        to,
        projects: formattedProjects,
        revenue: this.display(aggregate.revenueMicroUsd),
        cost: this.display(aggregate.costMicroUsd),
        margin: this.display(aggregate.marginMicroUsd),
        marginPercent: aggregate.marginPercent,
        byProject: aggregate.byProject.map((row) => ({
          key: row.key,
          cost: this.display(row.costMicroUsd),
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          requestCount: row.requestCount,
        })),
        byModel: aggregate.byModel.map((row) => ({
          key: row.key,
          cost: this.display(row.costMicroUsd),
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          requestCount: row.requestCount,
        })),
      },
    };
  }

  private async projectRows(projectId: ProjectId, from: IsoDateTime, to: IsoDateTime): Promise<PnLProjectRows> {
    const revenue = await this.deps.revenue.list({ projectId, from, to });
    const ledger: LedgerEntry[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.deps.ledger.query(
        { projectId, from, to, limit: 500, ...(cursor === undefined ? {} : { cursor }) },
        cursor === undefined ? undefined : decodeCursor(cursor),
        500,
      );
      ledger.push(...page.items.filter((entry) => entry.occurredAt < to));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return {
      projectId,
      revenue: revenue.map((entry): PnLRevenueRow => ({
        occurredAt: entry.occurredAt,
        amountMicroUsd: entry.amountMicroUsd,
      })),
      ledger: ledger.map((entry): PnLLedgerRow => ({
        occurredAt: entry.occurredAt,
        purpose: entry.purpose,
        modelKey: entry.modelKey,
        usage: entry.usage,
        costMicroUsd: entry.costMicroUsd,
      })),
    };
  }

  private formatProject(
    projectId: ProjectId,
    from: IsoDateTime,
    to: IsoDateTime,
    aggregate: ReturnType<typeof aggregateProject>,
  ): ProjectPnL {
    return {
      projectId,
      from,
      to,
      revenue: this.display(aggregate.revenueMicroUsd),
      cost: this.display(aggregate.costMicroUsd),
      margin: this.display(aggregate.marginMicroUsd),
      marginPercent: aggregate.marginPercent,
      byModel: aggregate.byModel.map((row) => ({ ...row, cost: this.display(row.costMicroUsd) })),
      byPurpose: aggregate.byPurpose.map((row) => ({ ...row, cost: this.display(row.costMicroUsd) })),
      byDay: aggregate.byDay.map((row) => ({ ...row, cost: this.display(row.costMicroUsd) })),
    };
  }

  private display(amount: number): MoneyDisplay {
    return toMoneyDisplay(signedMicroUsdSchema.parse(amount), this.deps.fx.getFxRate());
  }
}

function validateRange(from: IsoDateTime, to: IsoDateTime): Result<never> | null {
  return from >= to ? failure(ErrorCode.VALIDATION, 'The start of the P&L range must be before its end.') : null;
}

function decodeCursor(cursor: string): { readonly occurredAt: string; readonly id: string } {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.indexOf('|');
  if (separator < 1) throw new Error('Ledger repository returned an invalid cursor');
  return { occurredAt: decoded.slice(0, separator), id: decoded.slice(separator + 1) };
}

function failure<T>(code: AppError['code'], message: string): Result<T> {
  return {
    ok: false,
    error: { code, message, retryable: false, remediation: ['Choose a valid date range and try again.'] },
  };
}
