import type {
  AppError,
  LlmRequest,
  ModelDescriptor,
  ModelKey,
  PriceEntry,
  PriceUpdateRun,
  ProjectId,
  Result,
} from '@itstudio/schemas';
import type { Logger } from 'pino';
import type { IClock } from '../infra/clock.js';
import type { IIdGenerator } from '../infra/id.js';
import type { IHttpClient } from '../ports/http-client.js';
import type { IProjectRepository } from '../ports/project-repository.js';
import type { SettingsService } from './settings-service.js';
import type { PricingService } from './pricing-service.js';
import type { LlmRouter } from './llm-router.js';
import type { RpcEventBus } from '../rpc/event-bus.js';
import { validatePriceEntries } from '../domain/price-validation.js';
import { contextBlock, renderTemplate } from '../domain/template.js';
import { isoDateTimeSchema, llmRequestIdSchema, messageIdSchema, conversationIdSchema } from '../validation/brand.js';
import { z } from '../validation/common.js';
import { priceEntrySchema } from '../validation/cost.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_BYTES = 200 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RATE = 1_000_000_000;
const extractionResponseSchema = z.object({ entries: z.array(priceEntrySchema).readonly() });

export interface PricingUpdaterDependencies {
  readonly settings: Pick<SettingsService, 'get'>;
  readonly projects: IProjectRepository;
  readonly pricing: PricingService;
  readonly router: Pick<LlmRouter, 'dispatch'>;
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

export class PricingUpdater {
  private readonly deps: PricingUpdaterDependencies;
  private inFlight: Promise<Result<PriceUpdateRun>> | undefined;

  constructor(dependencies: PricingUpdaterDependencies) {
    this.deps = dependencies;
  }

  refresh(): Promise<Result<PriceUpdateRun>> {
    if (this.inFlight !== undefined) return this.inFlight;
    const running = this.run();
    this.inFlight = running;
    void running.finally(() => {
      if (this.inFlight === running) this.inFlight = undefined;
    });
    return running;
  }

  private async run(): Promise<Result<PriceUpdateRun>> {
    const settingsResult = await this.deps.settings.get();
    if (!settingsResult.ok) return settingsResult;
    const activeProjectId = settingsResult.value.activeProjectId;
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

    const startedAt = isoDateTimeSchema.parse(this.deps.clock.now().toISOString());
    const pagesByProvider = new Map<string, SourcePage[]>();
    let fetchFailures = 0;
    let fetchAttempts = 0;
    for (const [provider, urls] of Object.entries(this.deps.sources)) {
      for (const url of urls) {
        fetchAttempts += 1;
        try {
          const text = await this.fetchPage(url);
          const pages = pagesByProvider.get(provider) ?? [];
          pages.push({ url, text });
          pagesByProvider.set(provider, pages);
        } catch (error) {
          fetchFailures += 1;
          this.deps.logger.warn(
            { provider, url, error: error instanceof Error ? error.message : 'unknown' },
            'Pricing source fetch failed',
          );
        }
      }
    }

    if (fetchAttempts === 0 || fetchFailures === fetchAttempts) {
      const error = fetchFailure();
      return this.finish(startedAt, 'fetch_failed', [], error);
    }

    const current = this.deps.pricing.current();
    const settings = settingsResult.value.pricing;
    const storedOverrides = this.deps.pricing.manualOverrides();
    const knownModels = new Set(this.deps.models.map((model) => model.key));
    const allEntries: PriceEntry[] = [];
    const allDeltas: PriceUpdateRun['deltas'][number][] = [];
    let validationFailed = false;

    for (const [provider, pages] of pagesByProvider) {
      const providerModels = this.deps.models.filter((model) => model.key.split('/')[0] === provider);
      if (providerModels.length === 0 || pages.length === 0) continue;
      const extracted = await this.extract(
        provider,
        pages,
        providerModels,
        settings.extractionModelKey,
        activeProjectId,
      );
      if (!extracted.ok) {
        this.deps.logger.warn(
          { provider, error: extracted.error.message },
          'Pricing extraction failed; models omitted',
        );
        if (extracted.error.code === 'BUDGET_HARD_STOP') return extracted;
        continue;
      }
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
      if (!validated.valid) validationFailed = true;
    }

    if (validationFailed) return this.finish(startedAt, 'rejected_validation', allDeltas);
    if (
      !allEntries.some(
        (entry) =>
          !samePrice(
            current.entries.find((item) => item.modelKey === entry.modelKey),
            entry,
          ),
      )
    )
      return this.finish(startedAt, 'no_change', allDeltas);

    const table = this.deps.pricing.applyExtracted(allEntries);
    return this.finish(startedAt, 'applied', allDeltas, undefined, table.version);
  }

  private async fetchPage(url: string): Promise<string> {
    const response = await this.deps.http.request(url, {
      method: 'GET',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Pricing page returned HTTP ${String(response.status)}`);
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES)
      throw new Error('Pricing page exceeded the body limit');
    if (response.body === null) throw new Error('Pricing page had no body');
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
          throw new Error('Pricing page exceeded the body limit');
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
    const url = pages.map((page) => page.url).join(', ');
    const pageText = pages.map((page) => `[${page.url}]\n${page.text}`).join('\n\n');
    let prompt = renderTemplate(PRICING_PROMPT, {
      modelKeys: models.map((model) => model.key).join(', '),
      priceEntryJsonSchema: JSON.stringify(PRICE_ENTRY_JSON_SCHEMA),
      url,
      pageText: pageText.replace(/<\/context>/giu, '<\\/context>'),
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const request: LlmRequest = {
        id: llmRequestIdSchema.parse(this.deps.ids.uuid()),
        projectId,
        purpose: 'pricing_extraction',
        messages: [
          {
            id: messageIdSchema.parse(this.deps.ids.uuid()),
            conversationId: conversationIdSchema.parse(this.deps.ids.uuid()),
            role: 'user',
            parts: [{ type: 'text', text: 'Extract the listed API prices and return the requested JSON object.' }],
            createdAt: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
          },
        ],
        systemPrompt: prompt,
        requiredCapabilities: ['chat'],
        responseFormat: 'json',
        ladderOverride: [modelKey],
        stream: false,
      };
      const response = await this.deps.router.dispatch(request);
      if (!response.ok) return response;
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
          prompt = `${prompt}\n\n${contextBlock('validation_error', 'Return valid JSON with an entries array matching the requested schema.')}`;
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
    error?: AppError,
    version?: PriceUpdateRun['newVersion'],
  ): Result<PriceUpdateRun> {
    const run: PriceUpdateRun = {
      startedAt,
      finishedAt: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
      status,
      deltas,
      ...(version === undefined ? {} : { newVersion: version }),
      ...(error === undefined ? {} : { error }),
    };
    this.deps.events.publish('pricing.updated', run);
    return { ok: true, value: run };
  }
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
