import { ErrorCode, type AppError, type ProjectId, type Result, type RevenueEntry } from '@itstudio/schemas';
import type { IClock } from '../infra/clock.js';
import type { IIdGenerator } from '../infra/id.js';
import type { IProjectRepository } from '../ports/project-repository.js';
import type { IRevenueRepository } from '../ports/revenue-repository.js';
import { microUsd } from '../domain/money.js';
import { isoDateTimeSchema, projectIdSchema, revenueEntryIdSchema } from '../validation/brand.js';

export interface RevenueServiceDependencies {
  readonly repository: IRevenueRepository;
  readonly projects: IProjectRepository;
  readonly fx: { getEffective(): { readonly usdToVnd: number } };
  readonly ids: IIdGenerator;
  readonly clock: IClock;
}

export class RevenueService {
  private readonly deps: RevenueServiceDependencies;

  constructor(dependencies: RevenueServiceDependencies) {
    this.deps = dependencies;
  }

  async add(input: {
    readonly projectId: ProjectId;
    readonly amount: number;
    readonly currency: 'USD' | 'VND';
    readonly description: string;
  }): Promise<Result<RevenueEntry>> {
    const description = input.description.trim();
    if (!Number.isFinite(input.amount) || input.amount <= 0 || description.length > 500)
      return failure(
        ErrorCode.VALIDATION,
        'Revenue amount must be positive and description must be at most 500 characters.',
      );
    const project = await this.deps.projects.get(input.projectId);
    if (project === null) return failure(ErrorCode.NOT_FOUND, 'Project was not found.');
    let amountMicroUsd: number;
    try {
      const fxRate = input.currency === 'USD' ? undefined : this.deps.fx.getEffective().usdToVnd;
      amountMicroUsd = convertAmount(input.amount, fxRate);
    } catch {
      return failure(ErrorCode.VALIDATION, 'Revenue amount is outside the supported range.');
    }
    const entry: RevenueEntry = {
      id: revenueEntryIdSchema.parse(this.deps.ids.uuid()),
      projectId: projectIdSchema.parse(input.projectId),
      occurredAt: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
      amountMicroUsd: microUsd(amountMicroUsd),
      enteredCurrency: input.currency,
      description,
    };
    await this.deps.repository.insert(entry);
    return { ok: true, value: entry };
  }

  async list(projectId: ProjectId, from: string, to: string): Promise<Result<readonly RevenueEntry[]>> {
    if (from >= to) return failure(ErrorCode.VALIDATION, 'The start of the revenue range must be before its end.');
    if ((await this.deps.projects.get(projectId)) === null)
      return failure(ErrorCode.NOT_FOUND, 'Project was not found.');
    return { ok: true, value: await this.deps.repository.list({ projectId, from, to }) };
  }
}

function convertAmount(amount: number, usdToVnd: number | undefined): number {
  const amountRatio = decimalRatio(amount);
  const rateRatio = usdToVnd === undefined ? { numerator: 1n, denominator: 1n } : decimalRatio(usdToVnd);
  const numerator = amountRatio.numerator * rateRatio.denominator * 1_000_000n;
  const denominator = amountRatio.denominator * rateRatio.numerator;
  const rounded = (numerator + denominator / 2n) / denominator;
  const converted = Number(rounded);
  if (!Number.isSafeInteger(converted)) throw new RangeError('Revenue amount is outside the supported range');
  return converted;
}

function decimalRatio(value: number): { readonly numerator: bigint; readonly denominator: bigint } {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('Expected a positive finite number');
  const text = value.toString().toLowerCase();
  const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/u.exec(text);
  const whole = match?.[1];
  if (whole === undefined) throw new RangeError('Invalid decimal number');
  const fraction = match?.[2] ?? '';
  const exponent = Number(match?.[3] ?? '0');
  let numerator = BigInt(`${whole}${fraction}`);
  let denominator = 10n ** BigInt(fraction.length);
  if (exponent > 0) numerator *= 10n ** BigInt(exponent);
  if (exponent < 0) denominator *= 10n ** BigInt(-exponent);
  return { numerator, denominator };
}

function failure<T>(code: AppError['code'], message: string): Result<T> {
  return {
    ok: false,
    error: { code, message, retryable: false, remediation: ['Correct the revenue details and try again.'] },
  };
}
