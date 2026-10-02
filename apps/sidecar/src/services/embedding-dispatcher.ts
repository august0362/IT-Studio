import {
  CostPurpose,
  ErrorCode,
  FailureKind,
  type AppError,
  type EmbeddingConfig,
  type FailureKind as FailureKindType,
  type ModelDescriptor,
  type ModelKey,
  type ProjectId,
  type ProviderId as ProviderIdType,
  type Result,
} from '@itstudio/schemas';
import type { IIdGenerator } from '../infra/id.js';
import type { IEmbeddingProvider } from '../ports/embedding-provider.js';
import type { ISecretStore } from '../ports/secret-store.js';
import { failureToAppError } from '../domain/failure.js';
import { retryDelayMs } from '../domain/backoff.js';
import type { EventBus } from '../rpc/event-bus.js';
import type { RouterCompleted } from './llm-router.js';
import { llmRequestIdSchema, projectIdSchema } from '../validation/brand.js';

const MAX_ESTIMATED_TOKENS = 8_000;
const MAX_RETRIES = 2;
const TRANSIENT_FAILURES = new Set<FailureKindType>([
  FailureKind.RATE_LIMITED,
  FailureKind.QUOTA_EXHAUSTED,
  FailureKind.SERVER_ERROR,
  FailureKind.TIMEOUT,
]);

export interface EmbeddingContext {
  readonly projectId: ProjectId;
  readonly purpose: 'embedding';
}

export interface EmbeddingDispatcherDependencies {
  readonly config: EmbeddingConfig;
  readonly models: readonly ModelDescriptor[];
  readonly providers: Readonly<Partial<Record<ProviderIdType, IEmbeddingProvider>>>;
  readonly secrets: ISecretStore;
  readonly ids: IIdGenerator;
  readonly completed: EventBus<{ completed: RouterCompleted }>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

function failure(
  code: AppError['code'],
  message: string,
  remediation: readonly string[] = ['Check the embedding settings and try again.'],
): Result<never> {
  return { ok: false, error: { code, message, retryable: false, remediation } };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function normalize(vector: readonly number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? [...vector] : vector.map((value) => value / magnitude);
}

function modelByKey(models: readonly ModelDescriptor[], key: ModelKey): ModelDescriptor | undefined {
  return models.find((model) => model.key === key && model.capabilities.includes('embedding'));
}

function candidateKeys(config: EmbeddingConfig): readonly ModelKey[] {
  return [config.modelKey, ...config.fallbackModelKeys.filter((key) => key !== config.modelKey)];
}

export class EmbeddingDispatcher {
  private readonly deps: EmbeddingDispatcherDependencies;

  constructor(dependencies: EmbeddingDispatcherDependencies) {
    this.deps = dependencies;
  }

  async embed(texts: readonly string[], context: EmbeddingContext): Promise<Result<number[][]>> {
    if (texts.length === 0) return { ok: true, value: [] };
    if (!Number.isInteger(this.deps.config.batchSize) || this.deps.config.batchSize < 1)
      return failure(ErrorCode.VALIDATION, 'Embedding batch size must be a positive integer.');
    const oversized = texts.findIndex((text) => estimateTokens(text) > MAX_ESTIMATED_TOKENS);
    if (oversized >= 0)
      return failure(
        ErrorCode.VALIDATION,
        `Embedding input at index ${String(oversized)} exceeds the 8,000 estimated token limit. Split it into smaller chunks and try again.`,
      );

    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += this.deps.config.batchSize) {
      const batch = texts.slice(start, start + this.deps.config.batchSize);
      const result = await this.embedBatch(batch);
      if (!result.ok) return result;
      vectors.push(...result.value.vectors.map(normalize));
      const modelKey = result.value.modelKey;
      this.deps.completed.publish('completed', {
        requestId: llmRequestIdSchema.parse(this.deps.ids.uuid()),
        projectId: projectIdSchema.parse(context.projectId),
        purpose: CostPurpose.EMBEDDING,
        modelKey,
        usage: { inputTokens: result.value.inputTokens, outputTokens: 0, cachedInputTokens: 0 },
        billedFailure: false,
      });
    }
    return { ok: true, value: vectors };
  }

  private async embedBatch(
    texts: readonly string[],
  ): Promise<Result<{ readonly vectors: number[][]; readonly inputTokens: number; readonly modelKey: ModelKey }>> {
    let lastFailure: AppError | undefined;
    for (const key of candidateKeys(this.deps.config)) {
      const model = modelByKey(this.deps.models, key);
      if (model === undefined) continue;
      const provider = this.deps.providers[model.provider];
      if (provider === undefined) continue;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        const secretResult = await this.deps.secrets.get(model.provider);
        if (!secretResult.ok) return secretResult;
        if (secretResult.value === null)
          return failure(ErrorCode.SECRET_MISSING, `No API key is configured for ${model.provider}.`, [
            'Add an API key in Settings, then retry.',
          ]);
        const controller = new AbortController();
        let result;
        try {
          result = await provider.embed(
            texts,
            { modelId: model.providerModelId, dimensions: this.deps.config.dimensions },
            secretResult.value,
            controller.signal,
          );
        } catch {
          result = {
            ok: false,
            error: { kind: FailureKind.SERVER_ERROR, billed: false, message: 'The provider request failed.' },
          } as const;
        }
        if (result.ok) return { ok: true, value: { ...result.value, modelKey: model.key } };
        lastFailure = failureToAppError(result.error, model.provider, model.key);
        if (
          result.error.kind === FailureKind.BAD_REQUEST &&
          result.error.message.startsWith('Embedding provider returned')
        ) {
          lastFailure = { ...lastFailure, message: result.error.message };
        }
        if (!TRANSIENT_FAILURES.has(result.error.kind)) return { ok: false, error: lastFailure };
        if (attempt < MAX_RETRIES) {
          const delay = retryDelayMs(attempt, result.error.retryAfterMs, this.deps.random ?? Math.random);
          await (this.deps.sleep ?? defaultSleep)(delay);
          continue;
        }
        break;
      }
    }
    return {
      ok: false,
      error: lastFailure ?? {
        code: ErrorCode.LADDER_EXHAUSTED,
        message: 'No configured embedding provider is available.',
        retryable: false,
        remediation: ['Configure an embedding model and its provider API key, then retry.'],
      },
    };
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
