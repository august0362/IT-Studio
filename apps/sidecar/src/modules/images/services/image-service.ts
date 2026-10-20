import type { ProcessId, MicroUsd } from '@itstudio/schemas';
import type { IProcessTracker } from '../../../kernel/ports/process-tracker.js';
import { trackProcess, type ProcessActivity } from '../../../kernel/domain/process-activity.js';
import {
  CostPurpose,
  ErrorCode,
  FALLBACK_TRIGGERS,
  FailureKind,
  type AppError,
  type GenerateImageArgs,
  type ImageAsset,
  type ImageAssetId,
  type ImageMimeType,
  type ImageProviderId,
  type ProjectId,
  type Result,
  type ToolCallId,
} from '@itstudio/schemas';
import type { Logger } from 'pino';
import { join } from 'node:path';
import type { IClock } from '../../../kernel/infra/clock.js';
import type { IIdGenerator } from '../../../kernel/infra/id.js';
import type { IFileSystem } from '../../../kernel/ports/file-system.js';
import type { IImageProvider } from '../../../kernel/ports/image-provider.js';
import type { IImageRepository } from '../../../kernel/ports/image-repository.js';
import type { ILedgerRepository } from '../../../kernel/ports/ledger-repository.js';
import type { IBudgetGuard } from '../../../kernel/ports/budget-guard.js';
import type { SettingsService } from '../../settings/index.js';
import type { IPriceSource } from '../../cost/index.js';
import { microUsd } from '../../../kernel/domain/money.js';
import {
  imageAssetIdSchema,
  isoDateTimeSchema,
  ledgerEntryIdSchema,
  microUsdSchema,
  priceTableVersionSchema,
  projectIdSchema,
} from '../../../kernel/validation/brand.js';
import { modelKeySchema } from '../../../kernel/validation/common.js';
import { generateImageArgsSchema } from '../../../kernel/validation/chat.js';
import { imageGenerationRequestSchema } from '../../../kernel/validation/image.js';
import type { WorkflowInternalEventBus } from '../../../kernel/ports/workflow-internal-events.js';

export interface ImageServiceDependencies {
  readonly processes?: IProcessTracker;
  readonly costText?: (amount: MicroUsd) => string;
  readonly repository: IImageRepository;
  readonly ledger: ILedgerRepository;
  readonly budget: IBudgetGuard;
  readonly settings: Pick<SettingsService, 'get'>;
  readonly providers: readonly IImageProvider[];
  readonly prices: IPriceSource;
  readonly fileSystem: IFileSystem;
  readonly dataDir: string;
  readonly ids: IIdGenerator;
  readonly clock: IClock;
  readonly logger: Logger;
  readonly internalEvents?: WorkflowInternalEventBus;
}

export class ImageService {
  private readonly deps: ImageServiceDependencies;

  constructor(dependencies: ImageServiceDependencies) {
    this.deps = dependencies;
  }

  async generate(
    projectId: ProjectId,
    rawArgs: unknown,
    toolCallId: ToolCallId,
    signal: AbortSignal,
    retryOf?: ProcessId,
  ): Promise<Result<{ readonly assetIds: readonly ImageAssetId[] }>> {
    const parsed = generateImageArgsSchema.safeParse(rawArgs);
    if (!parsed.success)
      return failure(ErrorCode.VALIDATION, 'Image generation arguments are invalid.', ['Review the image prompt.']);
    const controller = new AbortController();
    const activity = trackProcess(this.deps.processes, 'image', {
      title: 'Image: ' + parsed.data.prompt.slice(0, 60),
      projectId,
      operation: { kind: 'image', params: { projectId, args: parsed.data } },
      cancel: () => {
        controller.abort();
        return Promise.resolve({ ok: true, value: undefined });
      },
      ...(retryOf === undefined ? {} : { retryOf }),
    });
    activity.done('prompt', 'Image prompt received');
    try {
      const result = await this.generateTracked(
        projectId,
        rawArgs,
        toolCallId,
        AbortSignal.any([signal, controller.signal]),
        activity,
      );
      if (!result.ok) activity.fail(result.error);
      else {
        const id = result.value.assetIds[0];
        if (id !== undefined) activity.annotate({ ref: { type: 'image', id } });
        activity.step('gallery');
        activity.finish(String(result.value.assetIds.length) + ' images saved');
      }
      return result;
    } catch (error) {
      this.deps.logger.error({ svc: 'image', projectId, err: error }, 'Image generation failed');
      activity.fail('Image generation failed unexpectedly');
      return failure(ErrorCode.INTERNAL, 'Image generation failed unexpectedly.', ['Retry the image request.']);
    }
  }

  private async generateTracked(
    projectId: ProjectId,
    rawArgs: unknown,
    toolCallId: ToolCallId,
    signal: AbortSignal,
    activity: ProcessActivity,
  ): Promise<Result<{ readonly assetIds: readonly ImageAssetId[] }>> {
    const parsedArgs = generateImageArgsSchema.safeParse(rawArgs);
    if (!parsedArgs.success || parsedArgs.data.prompt.trim().length === 0)
      return failure(ErrorCode.VALIDATION, 'Image generation arguments are invalid.', [
        'Provide a non-empty image prompt.',
      ]);
    const request = imageGenerationRequestSchema.safeParse({ projectId, args: parsedArgs.data, toolCallId });
    if (!request.success)
      return failure(ErrorCode.VALIDATION, 'Image generation request is invalid.', [
        'Review the image prompt and options.',
      ]);
    const settings = await this.deps.settings.get();
    if (!settings.ok) return settings;
    if (!settings.value.image.enabled)
      return failure(ErrorCode.VALIDATION, 'Image generation is disabled in Settings.', [
        'Enable image generation in Settings.',
      ]);

    const count = parsedArgs.data.count ?? 1;
    const priceTable = this.deps.prices.getPriceTable();
    const providerOrder = settings.value.image.providerOrder.filter((id) => id !== 'midjourney_proxy');
    const candidates = providerOrder.flatMap((id) => {
      const provider = this.deps.providers.find((candidate) => candidate.id === id);
      return provider === undefined ? [] : [provider];
    });
    const firstPrice = candidates
      .map((provider) => ({ provider, price: imagePrice(priceTable.entries, provider.id) }))
      .find((entry) => entry.price !== undefined);
    let estimatedCost = 0;
    if (firstPrice?.price?.perImageMicroUsd !== undefined) estimatedCost = firstPrice.price.perImageMicroUsd * count;
    else
      this.deps.logger.warn(
        { projectId, provider: firstPrice?.provider.id },
        'No image price is available; checking budget at zero cost',
      );
    activity.step('budget');
    const budget = await this.deps.budget.check(projectId, estimatedCost);
    if (!budget.ok) return budget;
    if (budget.value.blocking)
      return failure(ErrorCode.BUDGET_HARD_STOP, 'The project budget blocks image generation.', [
        'Raise the budget or turn off Hard Stop in Settings.',
      ]);

    let lastError: AppError | undefined;
    for (const provider of candidates) {
      if (isAborted(signal))
        return failure(ErrorCode.CANCELLED, 'Image generation was cancelled.', ['Retry when ready.']);
      activity.step('provider', undefined, { provider: provider.id, count });
      this.deps.internalEvents?.publish({ type: 'image', phase: 'started', projectId, provider: provider.id, count });
      const response = await provider.generate(request.data, signal);
      if (isAborted(signal))
        return failure(ErrorCode.CANCELLED, 'Image generation was cancelled.', ['Retry when ready.']);
      if (response.ok) {
        activity.step('download');
        activity.done('download', String(response.value.length) + ' images downloaded');
        lastError = undefined;
        if (response.value.length === 0) {
          this.deps.internalEvents?.publish({
            type: 'image',
            phase: 'failed',
            projectId,
            provider: provider.id,
            count,
          });
          lastError = providerFailure(provider.id, FailureKind.BAD_REQUEST);
          continue;
        }
        const price = imagePrice(priceTable.entries, provider.id);
        const assets: ImageAsset[] = [];
        activity.step('store');
        for (const image of response.value) {
          if (isAborted(signal))
            return failure(ErrorCode.CANCELLED, 'Image generation was cancelled.', ['Retry when ready.']);
          const stored = await this.store(projectId, provider.id, parsedArgs.data, image, price?.perImageMicroUsd ?? 0);
          if (!stored.ok) {
            if (assets.length === 0) {
              this.deps.internalEvents?.publish({
                type: 'image',
                phase: 'failed',
                projectId,
                provider: provider.id,
                count,
              });
              return stored;
            }
            lastError = stored.error;
            break;
          }
          assets.push(stored.value);
        }
        if (assets.length > 0) {
          const totalCost = price?.perImageMicroUsd === undefined ? 0 : price.perImageMicroUsd * assets.length;
          await this.recordLedger(projectId, provider.id, assets.length, totalCost, priceTable.version);
          const costText = this.deps.costText?.(microUsd(totalCost));
          if (costText !== undefined) activity.annotate({ costText });
          this.deps.internalEvents?.publish({
            type: 'image',
            phase: 'completed',
            projectId,
            provider: provider.id,
            count: assets.length,
            cost: totalCost,
          });
          const incomplete = assets.length < count || assets.length < response.value.length;
          return lastError === undefined && !incomplete
            ? { ok: true, value: { assetIds: assets.map((asset) => asset.id) } }
            : {
                ok: false,
                error: partialFailure(
                  lastError ??
                    failureError(ErrorCode.INTERNAL, 'The provider returned only part of the requested images.', [
                      'Retry the request for the missing images.',
                    ]),
                  assets.map((asset) => asset.id),
                ),
              };
        }
      } else {
        this.deps.internalEvents?.publish({
          type: 'image',
          phase: 'failed',
          projectId,
          provider: provider.id,
          count,
        });
        lastError = toAppError(response.error, provider.id);
        const trigger = 'kind' in response.error && FALLBACK_TRIGGERS.includes(response.error.kind);
        if (!trigger) return { ok: false, error: lastError };
      }
    }
    return {
      ok: false,
      error:
        lastError ??
        failureError(ErrorCode.LADDER_EXHAUSTED, 'No configured image provider is available.', [
          'Configure an image provider and API key.',
        ]),
    };
  }

  async list(projectId: ProjectId): Promise<Result<readonly ImageAsset[]>> {
    try {
      return { ok: true, value: await this.deps.repository.list(projectId) };
    } catch {
      return failure(ErrorCode.INTERNAL, 'Image assets could not be loaded.', ['Refresh the gallery and try again.']);
    }
  }

  async delete(assetId: ImageAssetId): Promise<Result<{ readonly deleted: boolean }>> {
    const asset = await this.deps.repository.get(assetId);
    if (asset === null) return { ok: true, value: { deleted: false } };
    const exists = await this.deps.fileSystem.exists(asset.localPath);
    if (!exists.ok) return exists;
    if (exists.value) {
      const removed = await this.deps.fileSystem.unlink(asset.localPath);
      if (!removed.ok) return removed;
    }
    const deleted = await this.deps.repository.delete(assetId);
    return { ok: true, value: { deleted } };
  }

  private async store(
    projectId: ProjectId,
    provider: ImageProviderId,
    args: GenerateImageArgs,
    image: { readonly bytes: Uint8Array; readonly mimeType: ImageMimeType; readonly revisedPrompt?: string },
    cost: number,
  ): Promise<Result<ImageAsset>> {
    const id = imageAssetIdSchema.parse(this.deps.ids.uuid());
    const extension = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.slice('image/'.length);
    const folder = join(this.deps.dataDir, 'images', projectId);
    const localPath = join(folder, `${id}.${extension}`);
    const created = await this.deps.fileSystem.mkdir(folder, true);
    if (!created.ok) return created;
    const written = await this.deps.fileSystem.writeFile(localPath, image.bytes);
    if (!written.ok) return written;
    const asset: ImageAsset = {
      id,
      projectId: projectIdSchema.parse(projectId),
      provider,
      prompt: args.prompt,
      ...(image.revisedPrompt === undefined ? {} : { revisedPrompt: image.revisedPrompt }),
      size: args.size ?? '1024x1024',
      mimeType: image.mimeType,
      localPath,
      cost: microUsdSchema.parse(cost),
      createdAt: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
    };
    try {
      await this.deps.repository.insert(asset);
    } catch {
      await this.deps.fileSystem.unlink(localPath);
      return failure(ErrorCode.INTERNAL, 'The generated image could not be recorded.', ['Retry the request.']);
    }
    return { ok: true, value: asset };
  }

  private async recordLedger(
    projectId: ProjectId,
    provider: ImageProviderId,
    count: number,
    cost: number,
    version: string,
  ): Promise<void> {
    const occurredAt = isoDateTimeSchema.parse(this.deps.clock.now().toISOString());
    await this.deps.ledger.insert({
      id: ledgerEntryIdSchema.parse(this.deps.ids.uuid()),
      projectId,
      occurredAt,
      purpose: CostPurpose.IMAGE,
      modelKey: imagePrice(this.deps.prices.getPriceTable().entries, provider)?.modelKey ?? imageModelKey(provider),
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      imageCount: count,
      costMicroUsd: microUsd(cost),
      priceTableVersion: priceTableVersionSchema.parse(version),
      billedFailure: false,
    });
  }
}

const IMAGE_PROVIDER_PREFIX: Readonly<Record<ImageProviderId, string>> = {
  openai_dalle3: 'openai',
  flux_together: 'together',
  flux_replicate: 'replicate',
  midjourney_proxy: 'midjourney',
};

function providerPrefix(provider: ImageProviderId): string {
  return IMAGE_PROVIDER_PREFIX[provider];
}

function imageModelKey(provider: ImageProviderId): ReturnType<typeof modelKeySchema.parse> {
  return modelKeySchema.parse(`${providerPrefix(provider)}/image-generation`);
}

function imagePrice(entries: ReturnType<IPriceSource['getPriceTable']>['entries'], provider: ImageProviderId) {
  return entries.find(
    (entry) => entry.modelKey.startsWith(`${providerPrefix(provider)}/`) && entry.perImageMicroUsd !== undefined,
  );
}

function toAppError(
  error: AppError | { readonly kind: (typeof FailureKind)[keyof typeof FailureKind]; readonly message: string },
  provider: ImageProviderId,
): AppError {
  if ('code' in error) return error;
  const codeByFailure: Readonly<Record<(typeof FailureKind)[keyof typeof FailureKind], AppError['code']>> = {
    rate_limited: ErrorCode.PROVIDER_RATE_LIMITED,
    quota_exhausted: ErrorCode.PROVIDER_QUOTA_EXHAUSTED,
    server_error: ErrorCode.PROVIDER_SERVER,
    timeout: ErrorCode.PROVIDER_TIMEOUT,
    auth: ErrorCode.PROVIDER_AUTH,
    bad_request: ErrorCode.PROVIDER_BAD_REQUEST,
    content_filtered: ErrorCode.PROVIDER_CONTENT_FILTERED,
    capability_mismatch: ErrorCode.LADDER_EXHAUSTED,
    circuit_open: ErrorCode.PROVIDER_RATE_LIMITED,
  };
  return {
    code: codeByFailure[error.kind],
    message: `Image provider ${provider} could not complete the request.`,
    retryable: FALLBACK_TRIGGERS.includes(error.kind),
    remediation: ['Review image provider credentials and availability, then retry.'],
  };
}

function providerFailure(provider: ImageProviderId, kind: (typeof FailureKind)[keyof typeof FailureKind]): AppError {
  return toAppError({ kind, message: 'Provider returned no images.' }, provider);
}

function failureError(code: AppError['code'], message: string, remediation: readonly string[]): AppError {
  return { code, message, retryable: false, remediation };
}

function failure<T = never>(code: AppError['code'], message: string, remediation: readonly string[]): Result<T> {
  return { ok: false, error: failureError(code, message, remediation) };
}

function partialFailure(error: AppError, assetIds: readonly ImageAssetId[]): AppError {
  return {
    ...error,
    message: `Some images were generated, but the request failed afterward. Stored asset IDs: ${assetIds.join(', ')}.`,
    details: { assetIds: [...assetIds] },
  };
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
