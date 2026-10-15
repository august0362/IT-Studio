import type { ProcessId, MicroUsd } from '@itstudio/schemas';
import type { IProcessTracker } from '../ports/process-tracker.js';
import { trackProcess, type ProcessActivity } from './process-activity.js';
import {
  ProviderId,
  type PriceUpdateOutcome,
  type PriceProviderOutcomeStatus,
  type ProviderId as ProviderIdType,
  type AppError,
  type FxRate,
  type PricingExtractionOptions,
  type LlmRequest,
  type ModelDescriptor,
  type ModelKey,
  type PriceEntry,
  type PriceUpdateRun,
  type ProjectId,
  type Result,
} from '@itstudio/schemas';
import type { Logger } from 'pino';
import type { IClock } from '../infra/clock.js';
import type { IIdGenerator } from '../infra/id.js';
import type { IHttpClient } from '../ports/http-client.js';
import type { IProjectRepository } from '../ports/project-repository.js';
import type { ISecretStore } from '../ports/secret-store.js';
import type { SettingsService } from './settings-service.js';
import type { PricingService } from './pricing-service.js';
import type { LlmRouter } from './llm-router.js';
import type { RpcEventBus } from '../rpc/event-bus.js';
import { validatePriceEntries } from '../domain/price-validation.js';
import { contextBlock, renderTemplate } from '../domain/template.js';
import { computeTokenCost } from '../domain/cost.js';
import { toMoneyDisplay } from '../domain/money.js';
import {
  isoDateTimeSchema,
  llmRequestIdSchema,
  messageIdSchema,
  conversationIdSchema,
  microUsdSchema,
} from '../validation/brand.js';
import { z } from '../validation/common.js';
import { priceEntrySchema } from '../validation/cost.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_BYTES = 200 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RATE = 1_000_000_000;
const EXTRACTION_OUTPUT_TOKENS = 2_000;
const MAX_EXTRACTION_ATTEMPTS = 2;
// Plan one input unit per UTF-8 byte, plus explicit framing allowance; tokenizer/provider accounting can vary.
const REQUEST_FRAMING_ALLOWANCE = 256;
const EXTRACTION_REQUEST_TEXT = 'Extract the listed API prices and return the requested JSON object.';
const EXTRACTION_RETRY_SUFFIX = `\n\n${contextBlock('validation_error', 'Return valid JSON with an entries array matching the requested schema.')}`;
const extractionResponseSchema = z.object({ entries: z.array(priceEntrySchema).readonly() });

export interface PricingUpdaterDependencies {
  readonly processes?: IProcessTracker;
  readonly costText?: (amount: MicroUsd) => string;
  readonly settings: Pick<SettingsService, 'get'>;
  readonly projects: IProjectRepository;
  readonly pricing: PricingService;
  readonly router: Pick<LlmRouter, 'dispatch'>;
  readonly secretStore: Pick<ISecretStore, 'get'>;
  readonly http: IHttpClient;
  readonly sources: Readonly<Record<string, readonly string[]>>;
  readonly models: readonly ModelDescriptor[];
  readonly events: RpcEventBus;
  readonly ids: IIdGenerator;
  readonly clock: IClock;
  readonly logger: Logger;
}

interface SourcePage {
  readonly url: string;
  readonly text: string;
}

interface ExtractionPlan {
  readonly maxOutputTokens: number;
  readonly inputUnits: number;
  readonly pageBytes: number;
  readonly fits: boolean;
}

class PricingPageError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export class PricingUpdater {
  private readonly deps: PricingUpdaterDependencies;
  private activity: ProcessActivity | undefined;
  private controller: AbortController | undefined;
  private extractionCost = 0;
  private inFlight: Promise<Result<PriceUpdateRun>> | undefined;

  constructor(dependencies: PricingUpdaterDependencies) {
    this.deps = dependencies;
  }

  refresh(replay?: {
    readonly projectId: ProjectId;
    readonly modelKey: ModelKey;
    readonly retryOf: ProcessId;
  }): Promise<Result<PriceUpdateRun>> {
    if (this.inFlight !== undefined) return this.inFlight;
    this.extractionCost = 0;
    const running = this.run(replay)
      .then((result) => {
        const costText = this.deps.costText?.(microUsdSchema.parse(this.extractionCost));
        if (costText !== undefined) this.activity?.annotate({ costText });
        if (result.ok)
          this.activity?.detail('fetch', {
            outcomes: result.value.providerOutcomes?.map((item) => ({ ...item })) ?? [],
          });
        if (!result.ok) this.activity?.fail(result.error);
        else if (result.value.status === 'applied' || result.value.status === 'no_change') {
          this.activity?.detail('save', {
            outcomes: result.value.providerOutcomes?.map((item) => ({ ...item })) ?? [],
          });
          this.activity?.finish('Price update ' + result.value.status);
        } else this.activity?.fail(result.value.error ?? 'Price update ' + result.value.status);
        return result;
      })
      .catch((error: unknown): Result<PriceUpdateRun> => {
        this.deps.logger.error({ svc: 'pricing', err: error }, 'Price update failed');
        this.activity?.fail('Price update failed unexpectedly');
        return {
          ok: false,
          error: {
            code: 'INTERNAL',
            message: 'Price update failed unexpectedly.',
            retryable: true,
            remediation: ['Retry the price update.'],
          },
        };
      });
    this.inFlight = running;
    void running.finally(() => {
      if (this.inFlight === running) {
        this.inFlight = undefined;
        this.activity = undefined;
        this.controller = undefined;
      }
    });
    return running;
  }

  async extractionOptions(fx: FxRate): Promise<Result<PricingExtractionOptions>> {
    const settings = await this.deps.settings.get();
    if (!settings.ok) return settings;
    const candidates = await this.keyedExtractionModels();
    const sources = this.extractionSources();
    const calls = sources.length * MAX_EXTRACTION_ATTEMPTS;
    const prices = new Map(this.deps.pricing.current().entries.map((entry) => [entry.modelKey, entry]));
    const options = candidates.flatMap((model) => {
      const price = prices.get(model.key);
      const plans = sources.map(({ models, urls }) => planExtraction(model, models, urls));
      const inputTokens = plans.reduce((sum, plan) => sum + plan.inputUnits, 0) * MAX_EXTRACTION_ATTEMPTS;
      const outputTokens = plans.reduce((sum, plan) => sum + plan.maxOutputTokens, 0) * MAX_EXTRACTION_ATTEMPTS;
      return price === undefined
        ? []
        : [
            {
              modelKey: model.key,
              displayName: model.displayName,
              estimatedCost: toMoneyDisplay(
                computeTokenCost({ inputTokens, outputTokens, cachedInputTokens: 0 }, price),
                fx,
              ),
            },
          ];
    });
    const selected =
      candidates.find((model) => model.key === settings.value.pricing.extractionModelKey) ?? candidates[0];
    const selectedPlans =
      selected === undefined ? [] : sources.map(({ models, urls }) => planExtraction(selected, models, urls));
    return {
      ok: true,
      value: {
        options,
        selectedModelKey: selected?.key ?? null,
        inputTokensPerCall: Math.max(0, ...selectedPlans.map((plan) => plan.inputUnits)),
        outputTokensPerCall: Math.max(0, ...selectedPlans.map((plan) => plan.maxOutputTokens)),
        calls,
      },
    };
  }

  private async run(replay?: {
    readonly projectId: ProjectId;
    readonly modelKey: ModelKey;
    readonly retryOf: ProcessId;
  }): Promise<Result<PriceUpdateRun>> {
    const settingsResult = await this.deps.settings.get();
    if (!settingsResult.ok) return settingsResult;
    const activeProjectId = replay?.projectId ?? settingsResult.value.activeProjectId;
    if (activeProjectId === null || (await this.deps.projects.get(activeProjectId)) === null) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION',
          message: 'Pricing updates require an active project.',
          retryable: false,
          remediation: ['Open or create a project first.'],
        },
      };
    }

    const modelResult = await this.selectExtractionModel(
      replay?.modelKey ?? settingsResult.value.pricing.extractionModelKey,
    );
    if (!modelResult.ok) return modelResult;
    const controller = new AbortController();
    this.controller = controller;
    this.activity = trackProcess(this.deps.processes, 'price_update', {
      title: 'Update prices',
      projectId: activeProjectId,
      operation: { kind: 'price_update', params: { projectId: activeProjectId, modelKey: modelResult.value } },
      cancel: async () => {
        controller.abort();
        await this.inFlight;
        return { ok: true, value: undefined };
      },
      ...(replay === undefined ? {} : { retryOf: replay.retryOf }),
    });
    this.activity.done('sources', String(Object.keys(this.deps.sources).length) + ' provider sources');
    this.activity.step('fetch');
    const startedAt = isoDateTimeSchema.parse(this.deps.clock.now().toISOString());
    this.activity.annotate({ ref: { type: 'price_run', id: this.activity.id ?? startedAt } });
    const pagesByProvider = new Map<ProviderIdType, SourcePage[]>();
    const fetchNotes = new Map<ProviderIdType, string>();
    const providerOutcomes: PriceUpdateOutcome[] = [];
    const providerSchema = z.enum(Object.values(ProviderId));
    let fetchFailures = 0;
    let fetchAttempts = 0;
    for (const [sourceProvider, urls] of Object.entries(this.deps.sources)) {
      const parsedProvider = providerSchema.safeParse(sourceProvider);
      if (!parsedProvider.success) continue;
      const provider = parsedProvider.data;
      const pages: SourcePage[] = [];
      const failures: string[] = [];
      pagesByProvider.set(provider, pages);
      for (const url of urls) {
        fetchAttempts += 1;
        try {
          const text = await this.fetchPage(url);
          pages.push({ url, text });
        } catch (error) {
          fetchFailures += 1;
          failures.push(
            error instanceof PricingPageError ? error.reason : 'Request failed or timed out; check your connection.',
          );
          this.deps.logger.warn({ provider, url, failed: error instanceof Error }, 'Pricing source fetch failed');
        }
      }
      if (pages.length === 0) {
        providerOutcomes.push(
          outcome(
            provider,
            'fetch_failed',
            `No configured pricing page could be loaded. ${[...new Set(failures)].join(' ')}`.trim(),
          ),
        );
      } else if (failures.length > 0) {
        fetchNotes.set(
          provider,
          `${String(failures.length)} source page(s) failed; used ${String(pages.length)} available page(s). ${[...new Set(failures)].join(' ')}`,
        );
      }
    }

    if (fetchAttempts === 0 || fetchFailures === fetchAttempts) {
      const error = fetchFailure();
      return this.finish(startedAt, 'fetch_failed', [], providerOutcomes, error);
    }

    const current = this.deps.pricing.current();
    const settings = settingsResult.value.pricing;
    const storedOverrides = this.deps.pricing.manualOverrides();
    const knownModels = new Set(this.deps.models.map((model) => model.key));
    const allEntries: PriceEntry[] = [];
    const allDeltas: PriceUpdateRun['deltas'][number][] = [];
    let validationFailed = false;
    let extractionError: AppError | undefined;

    for (const [provider, pages] of pagesByProvider) {
      const providerModels = this.deps.models.filter((model) => model.provider === provider);
      if (pages.length === 0) continue;
      if (providerModels.length === 0) {
        providerOutcomes.push(outcome(provider, 'no_change', 'No known models are configured for this provider.'));
        continue;
      }
      if (isAborted(controller.signal)) return priceCancelled();
      this.activity.step('extract', undefined, { provider, model: modelResult.value });
      const extracted = await this.extract(provider, pages, providerModels, modelResult.value, activeProjectId);
      if (!extracted.ok) {
        this.deps.logger.warn({ provider, code: extracted.error.code }, 'Pricing extraction failed; models omitted');
        if (extracted.error.code === 'BUDGET_HARD_STOP') return extracted;
        extractionError = validationFailure('Price extraction failed. The last-known-good prices were kept.');
        providerOutcomes.push(
          outcome(
            provider,
            'extraction_failed',
            `Price extraction failed (${extracted.error.code}); prices were kept. ${fetchNotes.get(provider) ?? ''}`.trim(),
          ),
        );
        continue;
      }
      if (isAborted(controller.signal)) return priceCancelled();
      this.activity.step('validate', undefined, { provider });
      const validated = validatePriceEntries(
        provider,
        extracted.value,
        current,
        knownModels,
        settings.maxAutoChangePercent,
        storedOverrides,
      );
      for (const modelKey of validated.unknownModels)
        this.deps.logger.warn({ provider, modelKey }, 'Pricing extraction returned an unknown model; dropping it');
      allEntries.push(...validated.entries);
      allDeltas.push(...validated.deltas);
      if (!validated.valid) {
        validationFailed = true;
        providerOutcomes.push(
          outcome(
            provider,
            'rejected_validation',
            `Extracted prices failed bounds, duplicate or maximum-change validation. ${fetchNotes.get(provider) ?? ''}`.trim(),
          ),
        );
      } else {
        const dropped = validated.unknownModels.length;
        const skipped = extracted.value.length - validated.entries.length - dropped;
        const omissions = `${String(dropped)} unknown and ${String(skipped)} foreign or manually overridden entries were omitted.`;
        providerOutcomes.push(
          outcome(
            provider,
            validated.changed ? 'applied' : 'no_change',
            `${validated.changed ? 'Validated changes accepted.' : 'No price changes found.'} ${omissions} ${fetchNotes.get(provider) ?? ''}`.trim(),
          ),
        );
      }
    }

    if (isAborted(controller.signal)) return priceCancelled();
    this.activity.detail('validate', { outcomes: providerOutcomes.map((item) => ({ ...item })) });
    if (validationFailed) {
      const rejectedOutcomes = providerOutcomes.map((item) =>
        item.status === 'applied'
          ? outcome(
              item.provider,
              'rejected_validation',
              'Another provider failed validation; this atomic update kept every previous price.',
            )
          : item,
      );
      return this.finish(startedAt, 'rejected_validation', allDeltas, rejectedOutcomes);
    }
    const changed = allEntries.some(
      (entry) =>
        !samePrice(
          current.entries.find((item) => item.modelKey === entry.modelKey),
          entry,
        ),
    );
    const needsProvenance = allEntries.some(
      (entry) => current.entries.find((item) => item.modelKey === entry.modelKey)?.origin !== 'auto_extracted',
    );
    if (!changed && !needsProvenance) {
      const succeeded = providerOutcomes.some((item) => item.status === 'no_change');
      return this.finish(
        startedAt,
        succeeded ? 'no_change' : 'fetch_failed',
        allDeltas,
        providerOutcomes,
        extractionError,
      );
    }
    this.activity.step('save');
    const table = this.deps.pricing.applyExtracted(allEntries);
    return this.finish(
      startedAt,
      changed ? 'applied' : 'no_change',
      allDeltas,
      providerOutcomes,
      undefined,
      table.version,
    );
  }

  private async selectExtractionModel(configured: ModelKey): Promise<Result<ModelKey>> {
    const candidates = await this.keyedExtractionModels();
    const preferred = candidates.find((model) => model.key === configured);
    const selected = preferred ?? candidates[0];
    if (selected !== undefined) return { ok: true, value: selected.key };
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message: 'Add an API key first — price extraction needs one AI call (cost shown before running).',
        retryable: false,
        remediation: ['Add an API key in Settings, then try updating prices again.'],
      },
    };
  }

  private async keyedExtractionModels(): Promise<ModelDescriptor[]> {
    const prices = new Map(
      this.deps.pricing.current().entries.map((entry) => [entry.modelKey, entry.inputPerMTokMicroUsd]),
    );
    const sources = this.extractionSources();
    const eligible = this.deps.models.filter(
      (model) =>
        model.enabled &&
        model.capabilities.includes('chat') &&
        model.capabilities.includes('json_mode') &&
        model.maxOutputTokens > 0 &&
        sources.every(({ models, urls }) => planExtraction(model, models, urls).fits) &&
        prices.has(model.key),
    );
    const keyedProviders = new Set<ProviderIdType>();
    for (const provider of new Set(eligible.map((model) => model.provider))) {
      const secret = await this.deps.secretStore.get(provider);
      if (secret.ok && secret.value !== null && secret.value.trim().length > 0) keyedProviders.add(provider);
      else if (!secret.ok)
        this.deps.logger.warn({ provider, code: secret.error.code }, 'Pricing extraction key lookup failed');
    }
    const candidates = eligible.filter((model) => keyedProviders.has(model.provider));
    candidates.sort(
      (left, right) =>
        (prices.get(left.key) ?? Infinity) - (prices.get(right.key) ?? Infinity) || left.key.localeCompare(right.key),
    );
    return candidates;
  }

  private extractionSources(): { readonly models: readonly ModelDescriptor[]; readonly urls: readonly string[] }[] {
    return Object.entries(this.deps.sources).flatMap(([provider, urls]) => {
      const models = this.deps.models.filter((model) => model.provider === provider);
      return urls.length > 0 && models.length > 0 ? [{ models, urls }] : [];
    });
  }

  private async fetchPage(url: string): Promise<string> {
    const response = await this.deps.http.request(url, {
      method: 'GET',
      signal: AbortSignal.any([
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(this.controller === undefined ? [] : [this.controller.signal]),
      ]),
    });
    if (!response.ok) throw new PricingPageError(`Pricing page returned HTTP ${String(response.status)}.`);
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES)
      throw new PricingPageError('Pricing page exceeded the body limit.');
    if (response.body === null) throw new PricingPageError('Pricing page had no body.');
    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          throw new PricingPageError('Pricing page exceeded the body limit.');
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
    const contentType = response.headers.get('content-type') ?? '';
    const text =
      /html/iu.test(contentType) || /^\s*</u.test(html)
        ? await (async () => {
            const { convert: htmlToText } = await import('html-to-text');
            return htmlToText(html, {
              wordwrap: false,
              selectors: [
                { selector: 'script', format: 'skip' },
                { selector: 'style', format: 'skip' },
              ],
            });
          })()
        : html;
    return Buffer.from(text, 'utf8').subarray(0, MAX_TEXT_BYTES).toString('utf8');
  }

  private async extract(
    provider: string,
    pages: readonly SourcePage[],
    models: readonly ModelDescriptor[],
    modelKey: ModelKey,
    projectId: ProjectId,
  ): Promise<Result<readonly PriceEntry[]>> {
    const extractionModel = this.deps.models.find((model) => model.key === modelKey);
    if (extractionModel === undefined)
      return { ok: false, error: validationFailure('The extraction model is unavailable.') };
    const urls = pages.map((page) => page.url);
    const plan = planExtraction(extractionModel, models, urls);
    if (!plan.fits)
      return { ok: false, error: validationFailure('The extraction model context cannot fit the pricing metadata.') };
    const maxOutputTokens = plan.maxOutputTokens;
    const bytesPerPage = Math.floor(plan.pageBytes / Math.max(1, pages.length));
    const pageText = pages
      .map(
        (page) =>
          `[${page.url}]\n${truncateUtf8(page.text.replace(/<\/context\s*>/giu, '<\\/context>'), bytesPerPage)}`,
      )
      .join('\n\n');
    let prompt = extractionPrompt(models, urls, pageText);
    for (let attempt = 0; attempt < MAX_EXTRACTION_ATTEMPTS; attempt += 1) {
      if (requestInputUnits(prompt) + maxOutputTokens > extractionModel.contextWindowTokens) {
        return {
          ok: false,
          error: validationFailure('The extraction request exceeds the model context planning limit.'),
        };
      }
      const request: LlmRequest = {
        id: llmRequestIdSchema.parse(this.deps.ids.uuid()),
        projectId,
        purpose: 'pricing_extraction',
        messages: [
          {
            id: messageIdSchema.parse(this.deps.ids.uuid()),
            conversationId: conversationIdSchema.parse(this.deps.ids.uuid()),
            role: 'user',
            parts: [{ type: 'text', text: EXTRACTION_REQUEST_TEXT }],
            createdAt: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
          },
        ],
        systemPrompt: prompt,
        requiredCapabilities: ['chat', 'json_mode'],
        responseFormat: 'json',
        maxOutputTokens,
        ladderOverride: [modelKey],
        stream: false,
      };
      const response = await this.deps.router.dispatch(
        request,
        this.controller === undefined ? undefined : { signal: this.controller.signal },
      );
      if (!response.ok) return response;
      this.extractionCost += response.value.costMicroUsd;
      this.activity?.detail('extract', { model: response.value.modelKey, ...response.value.usage });
      const text = response.value.message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('');
      try {
        const decoded: unknown = JSON.parse(text);
        const parsed = extractionResponseSchema.safeParse(decoded);
        if (parsed.success) return { ok: true, value: parsed.data.entries };
        throw new Error('The response did not match the price entry schema.');
      } catch {
        if (attempt === 0) {
          prompt += EXTRACTION_RETRY_SUFFIX;
          continue;
        }
      }
    }
    return { ok: false, error: validationFailure('The pricing extraction response was invalid after one retry.') };
  }

  private finish(
    startedAt: PriceUpdateRun['startedAt'],
    status: PriceUpdateRun['status'],
    deltas: PriceUpdateRun['deltas'],
    providerOutcomes: readonly PriceUpdateOutcome[],
    error?: AppError,
    version?: PriceUpdateRun['newVersion'],
  ): Result<PriceUpdateRun> {
    const run: PriceUpdateRun = {
      startedAt,
      finishedAt: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
      status,
      deltas,
      providerOutcomes,
      ...(version === undefined ? {} : { newVersion: version }),
      ...(error === undefined ? {} : { error }),
    };
    this.deps.events.publish('pricing.updated', run);
    return { ok: true, value: run };
  }
}

function extractionPrompt(models: readonly ModelDescriptor[], urls: readonly string[], pageText: string): string {
  return renderTemplate(PRICING_PROMPT, {
    modelKeys: models.map((model) => model.key).join(', '),
    priceEntryJsonSchema: JSON.stringify(PRICE_ENTRY_JSON_SCHEMA),
    url: urls.join(', '),
    pageText,
  });
}

function requestInputUnits(prompt: string): number {
  return (
    Buffer.byteLength(prompt, 'utf8') + Buffer.byteLength(EXTRACTION_REQUEST_TEXT, 'utf8') + REQUEST_FRAMING_ALLOWANCE
  );
}

function planExtraction(
  model: ModelDescriptor,
  models: readonly ModelDescriptor[],
  urls: readonly string[],
): ExtractionPlan {
  const maxOutputTokens = Math.min(EXTRACTION_OUTPUT_TOKENS, model.maxOutputTokens);
  const headers = urls.map((url) => `[${url}]\n`).join('\n\n');
  const overhead = requestInputUnits(extractionPrompt(models, urls, headers) + EXTRACTION_RETRY_SUFFIX);
  const available = model.contextWindowTokens - maxOutputTokens - overhead;
  const pageBytes = Math.min(MAX_TEXT_BYTES, Math.max(0, available));
  return { maxOutputTokens, inputUnits: overhead + pageBytes, pageBytes, fits: available > 0 };
}

function truncateUtf8(value: string, bytes: number): string {
  // Streaming decode omits a trailing incomplete codepoint instead of expanding it into a replacement character.
  return new TextDecoder().decode(Buffer.from(value, 'utf8').subarray(0, bytes), { stream: true });
}

function outcome(provider: ProviderIdType, status: PriceProviderOutcomeStatus, reason: string): PriceUpdateOutcome {
  return { provider, status, reason };
}

const PRICING_PROMPT = `Extract current API prices for the listed models from the page text.
Return {"entries": PriceEntry[]} using µUSD per 1M tokens (1 USD = 1000000). If a model is not on the page, omit it.
Do not guess. Use the standard (non-batch, non-priority) tier. freeTier=true only if the page states a free tier price of 0.
Models: {{modelKeys}}
Schema: {{priceEntryJsonSchema}}
<context name="page" source="{{url}}">{{pageText}}</context>`;

const PRICE_ENTRY_JSON_SCHEMA = {
  type: 'object',
  required: [
    'modelKey',
    'inputPerMTokMicroUsd',
    'outputPerMTokMicroUsd',
    'cachedInputPerMTokMicroUsd',
    'freeTier',
    'sourceUrl',
  ],
  properties: {
    modelKey: { type: 'string' },
    inputPerMTokMicroUsd: { type: 'integer', minimum: 0, maximum: MAX_RATE },
    outputPerMTokMicroUsd: { type: 'integer', minimum: 0, maximum: MAX_RATE },
    cachedInputPerMTokMicroUsd: { type: 'integer', minimum: 0, maximum: MAX_RATE },
    perImageMicroUsd: { type: 'integer', minimum: 0, maximum: MAX_RATE },
    freeTier: { type: 'boolean' },
    sourceUrl: { type: 'string' },
  },
};

function samePrice(previous: PriceEntry | undefined, entry: PriceEntry): boolean {
  if (previous === undefined) return false;
  return (
    previous.inputPerMTokMicroUsd === entry.inputPerMTokMicroUsd &&
    previous.outputPerMTokMicroUsd === entry.outputPerMTokMicroUsd &&
    previous.cachedInputPerMTokMicroUsd === entry.cachedInputPerMTokMicroUsd &&
    previous.perImageMicroUsd === entry.perImageMicroUsd &&
    previous.freeTier === entry.freeTier &&
    previous.sourceUrl === entry.sourceUrl
  );
}

function fetchFailure(): AppError {
  return {
    code: 'PROVIDER_SERVER',
    message: 'Every configured pricing page failed to load.',
    retryable: true,
    remediation: ['Check your internet connection and retry the price update.'],
  };
}

function validationFailure(message: string): AppError {
  return { code: 'VALIDATION', message, retryable: false, remediation: ['Review the pricing response and try again.'] };
}

function priceCancelled(): Result<never> {
  return {
    ok: false,
    error: {
      code: 'CANCELLED',
      message: 'Price update was cancelled.',
      retryable: true,
      remediation: ['Retry the price update.'],
    },
  };
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
