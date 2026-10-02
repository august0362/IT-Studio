import {
  ErrorCode,
  type AppError,
  type LedgerEntry,
  type LedgerQuery,
  type LlmRequest,
  type MoneyDisplay,
  type Page,
  type Result,
  type RpcNotificationMap,
} from '@itstudio/schemas';
import type { Logger } from 'pino';
import type { IClock } from '../infra/clock.js';
import type { IIdGenerator } from '../infra/id.js';
import type { ILedgerRepository } from '../ports/ledger-repository.js';
import type { EventBus } from '../rpc/event-bus.js';
import type { RouterCompleted } from './llm-router.js';
import type { IPriceSource } from './price-source.js';
import { computeTokenCost } from '../domain/cost.js';
import { microUsd, toMoneyDisplay } from '../domain/money.js';
import { isoDateTimeSchema, ledgerEntryIdSchema } from '../validation/brand.js';
import { modelKeySchema, priceTableVersionSchema, projectIdSchema, z } from '../validation/common.js';

interface RequestAttribution {
  readonly conversationId?: LedgerEntry['conversationId'];
  readonly pipelineRunId?: LedgerEntry['pipelineRunId'];
}

export interface LedgerServiceDependencies {
  readonly repository: ILedgerRepository;
  readonly prices: IPriceSource;
  readonly completed: { subscribe(name: 'completed', handler: (event: RouterCompleted) => void): () => void };
  readonly events: EventBus<RpcNotificationMap>;
  readonly ids: IIdGenerator;
  readonly clock: IClock;
  readonly logger: Logger;
}

export class LedgerService {
  private readonly deps: LedgerServiceDependencies;
  private readonly attributions = new Map<string, RequestAttribution>();
  private readonly recordedCosts = new Map<string, Promise<MoneyDisplay>>();
  private readonly warnedModels = new Set<string>();

  constructor(dependencies: LedgerServiceDependencies) {
    this.deps = dependencies;
    dependencies.completed.subscribe('completed', (event) => {
      const recording = this.recordCompletion(event);
      this.recordedCosts.set(event.requestId, recording);
      void recording.catch((error: unknown) => {
        dependencies.logger.error({ requestId: event.requestId, err: error }, 'Ledger entry could not be recorded');
      });
    });
  }

  trackRequest(request: LlmRequest): void {
    const conversationId = request.messages[0]?.conversationId;
    this.attributions.set(request.id, {
      ...(conversationId === undefined ? {} : { conversationId }),
      ...(request.pipelineRunId === undefined ? {} : { pipelineRunId: request.pipelineRunId }),
    });
  }

  forgetRequest(requestId: string): void {
    this.attributions.delete(requestId);
    this.recordedCosts.delete(requestId);
  }

  async recordedCost(requestId: string): Promise<MoneyDisplay | undefined> {
    const recording = this.recordedCosts.get(requestId);
    if (recording === undefined) return undefined;
    try {
      return await recording;
    } finally {
      if (this.recordedCosts.get(requestId) === recording) this.recordedCosts.delete(requestId);
    }
  }

  async query(query: LedgerQuery): Promise<Result<Page<LedgerEntry>>> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 500)
      return failure(ErrorCode.VALIDATION, 'Ledger page limit must be between 1 and 500.', [
        'Choose a limit from 1 to 500.',
      ]);
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    if (query.cursor !== undefined && cursor === null)
      return failure(ErrorCode.VALIDATION, 'Ledger cursor is invalid.', ['Refresh the ledger and try again.']);
    return {
      ok: true,
      value: await this.deps.repository.query(query, cursor ?? undefined, query.limit),
    };
  }

  private async recordCompletion(event: RouterCompleted): Promise<MoneyDisplay> {
    const priceTable = this.deps.prices.getPriceTable();
    const price = priceTable.entries.find((entry) => entry.modelKey === event.modelKey);
    let cost = microUsd(0);
    if (price === undefined) {
      if (!this.warnedModels.has(event.modelKey)) {
        this.warnedModels.add(event.modelKey);
        this.deps.logger.warn({ modelKey: event.modelKey }, 'No price is available; recording zero cost');
      }
    } else {
      cost = computeTokenCost(event.usage, price);
    }
    const fx = this.deps.prices.getFxRate();
    const display = toMoneyDisplay(cost, fx);
    const attribution = this.attributions.get(event.requestId);
    const pipelineRunId = event.pipelineRunId ?? attribution?.pipelineRunId;
    if (!event.billedFailure) this.attributions.delete(event.requestId);
    const entry: LedgerEntry = {
      id: ledgerEntryIdSchema.parse(this.deps.ids.uuid()),
      projectId: projectIdSchema.parse(event.projectId),
      occurredAt: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
      purpose: event.purpose,
      modelKey: modelKeySchema.parse(event.modelKey),
      llmRequestId: event.requestId,
      ...(attribution?.conversationId === undefined ? {} : { conversationId: attribution.conversationId }),
      ...(pipelineRunId === undefined ? {} : { pipelineRunId }),
      usage: event.usage,
      costMicroUsd: cost,
      priceTableVersion: priceTableVersionSchema.parse(priceTable.version),
      billedFailure: event.billedFailure,
    };
    await this.deps.repository.insert(entry);
    this.deps.events.publish('ledger.entry', { entry, cost: display });
    return display;
  }
}

function decodeCursor(value: string): { readonly occurredAt: string; readonly id: string } | null {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const separator = decoded.indexOf('|');
    if (separator < 1) return null;
    const occurredAt = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    const date = isoDateTimeSchema.safeParse(occurredAt);
    const parsedId = z.uuid().safeParse(id);
    return date.success && parsedId.success ? { occurredAt, id } : null;
  } catch {
    return null;
  }
}

function failure<T>(code: AppError['code'], message: string, remediation: readonly string[]): Result<T> {
  return { ok: false, error: { code, message, retryable: false, remediation } };
}
