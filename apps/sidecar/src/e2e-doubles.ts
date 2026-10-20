import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ErrorCode,
  FailureKind,
  ImageProviderId,
  type AppError,
  type ProviderId,
  type Result,
} from '@itstudio/schemas';
import type { Logger } from 'pino';
import { z } from 'zod';
import { FakeEmbeddingProvider } from './kernel/infra/fake-embedding-provider.js';
import { FakeImageProvider } from './kernel/infra/fake-image-provider.js';
import type { IProviderKeyVerifier } from './kernel/infra/http/provider-key-verifier.js';
import { MemorySecretStore } from './kernel/infra/memory-secret-store.js';
import type { IBrowserLauncher } from './kernel/ports/browser-launcher.js';
import type { IHttpClient } from './kernel/ports/http-client.js';
import type { ILlmProvider, ProviderFailure, ProviderRequest, ProviderResponse } from './kernel/ports/llm-provider.js';
import { toolCallSchema } from './kernel/validation/chat.js';
import { jsonObjectSchema } from './kernel/validation/common.js';

// Scripted doubles for ITSTUDIO_E2E=1 runs: no network, keychain, browser or paid API is touched.

type VerifierOutcome = 'success' | 'auth' | 'server' | 'timeout';
const verifierOutcomeSchema = z.enum(['success', 'auth', 'server', 'timeout']);
const verifierFixtureSchema = z.record(z.string(), verifierOutcomeSchema);
const imageScriptSchema = z.partialRecord(
  z.enum([ImageProviderId.OPENAI_DALLE3, ImageProviderId.FLUX_TOGETHER, ImageProviderId.FLUX_REPLICATE]),
  z.array(z.string().regex(/^(success|http:\d{3})$/u)),
);

class ScriptedKeyVerifier implements IProviderKeyVerifier {
  private readonly outcomes: Readonly<Record<string, VerifierOutcome>>;
  private readonly override: VerifierOutcome | undefined;

  constructor(override: string | undefined, fixturePath: string) {
    this.outcomes = verifierFixtureSchema.parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
    const parsedOverride = verifierOutcomeSchema.safeParse(override);
    this.override = parsedOverride.success ? parsedOverride.data : undefined;
  }

  async verify(provider: ProviderId): Promise<Result<void>> {
    const outcome = this.override ?? this.outcomes[provider] ?? 'success';
    if (outcome === 'success') return { ok: true, value: undefined };
    if (outcome === 'timeout') {
      await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 10_000));
      const error: AppError = {
        code: ErrorCode.PROVIDER_TIMEOUT,
        message: `The ${provider} verification request timed out.`,
        retryable: true,
        remediation: ['Try verifying the API key again.'],
      };
      return { ok: false, error };
    }
    if (outcome === 'auth') {
      return {
        ok: false,
        error: {
          code: ErrorCode.PROVIDER_AUTH,
          message: `The API key for ${provider} was rejected.`,
          retryable: false,
          remediation: [`Re-enter the API key for ${provider}.`],
        },
      };
    }
    return {
      ok: false,
      error: {
        code: ErrorCode.PROVIDER_SERVER,
        message: `The ${provider} service is unavailable.`,
        retryable: true,
        remediation: ['Try verifying the API key again shortly.'],
      },
    };
  }
}

const scriptedLlmFixtureSchema = z.object({ models: z.record(z.string(), z.array(z.string())) });
const embeddingOutcomeSchema = z.enum(['ok', 'http:503', 'quota', 'auth']);
const embeddingScriptSchema = z.record(z.string(), z.array(embeddingOutcomeSchema));
const scriptedLlmTextsSchema = z.record(z.string(), z.string());
const scriptedToolCallSchema = z.object({
  name: z.enum(['generate_image', 'search_knowledge']),
  arguments: jsonObjectSchema,
});

export function scriptedLlmProvider(
  id: ProviderId,
  texts: string | Readonly<Record<string, string>>,
  scripts: Readonly<Record<string, readonly string[]>>,
  cursors: Map<string, number>,
  capturePath?: string,
): ILlmProvider {
  const outputText = (request: ProviderRequest): string =>
    typeof texts === 'string' ? texts : (texts[request.modelId] ?? '{}');
  const response = (request: ProviderRequest, outcome: string): ProviderResponse => {
    const toolPrefix = 'tool:';
    let toolCalls: ProviderResponse['toolCalls'] = [];
    if (outcome.startsWith(toolPrefix)) {
      const raw: unknown = JSON.parse(outcome.slice(toolPrefix.length));
      const fixture = scriptedToolCallSchema.parse(raw);
      toolCalls = [toolCallSchema.parse({ id: 'call_scripted', ...fixture })];
    }
    return {
      text: toolCalls.length > 0 ? '' : outputText(request),
      toolCalls,
      usage: { inputTokens: 12, outputTokens: 8, cachedInputTokens: 0 },
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      providerModelId: request.modelId,
    };
  };
  const next = (request: ProviderRequest): string => {
    const key = `${id}/${request.modelId}`;
    const cursor = cursors.get(key) ?? 0;
    cursors.set(key, cursor + 1);
    return scripts[key]?.[cursor] ?? scripts[request.modelId]?.[cursor] ?? 'ok';
  };
  const wait = async (ms: number, signal: AbortSignal): Promise<boolean> => {
    if (signal.aborted) return false;
    await new Promise<void>((resolveDelay) => {
      const timer = setTimeout(resolveDelay, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolveDelay();
        },
        { once: true },
      );
    });
    return !signal.aborted;
  };
  const failed = (outcome: string): Result<never, ProviderFailure> => {
    if (outcome === 'quota')
      return {
        ok: false,
        error: { kind: FailureKind.QUOTA_EXHAUSTED, billed: false, message: 'Scripted quota failure.' },
      };
    if (outcome === 'auth')
      return {
        ok: false,
        error: { kind: FailureKind.AUTH, billed: false, httpStatus: 401, message: 'Scripted authentication failure.' },
      };
    if (outcome === 'content_filter')
      return {
        ok: false,
        error: { kind: FailureKind.CONTENT_FILTERED, billed: false, message: 'Scripted content filter.' },
      };
    const http = /^http:(\d{3})(?::(\d+))?$/u.exec(outcome);
    if (http !== null) {
      const status = Number(http[1]);
      const kind =
        status === 429 ? FailureKind.RATE_LIMITED : status >= 500 ? FailureKind.SERVER_ERROR : FailureKind.SERVER_ERROR;
      return {
        ok: false,
        error: {
          kind,
          billed: false,
          httpStatus: status,
          ...(http[2] === undefined ? {} : { retryAfterMs: Number(http[2]) }),
          message: `Scripted HTTP ${String(status)} failure with body key ${['sk', 'fake', 'provider', 'error', 'body'].join('-')}.`,
        },
      };
    }
    return {
      ok: false,
      error: { kind: FailureKind.SERVER_ERROR, billed: false, message: 'Unknown scripted outcome.' },
    };
  };
  const run = async (
    request: ProviderRequest,
    signal: AbortSignal,
    onDelta?: (chunk: string) => void,
  ): Promise<Result<ProviderResponse, ProviderFailure>> => {
    if (capturePath !== undefined)
      appendFileSync(
        capturePath,
        `${JSON.stringify({ ...(request.system === undefined ? {} : { system: request.system }), messages: request.messages })}\n`,
        'utf8',
      );
    const outcome = next(request);
    const delay = /^delay:(\d+)$/u.exec(outcome);
    if (delay !== null && !(await wait(Number(delay[1]), signal)))
      return { ok: false, error: { kind: FailureKind.TIMEOUT, billed: false, message: 'Scripted request cancelled.' } };
    if (signal.aborted)
      return { ok: false, error: { kind: FailureKind.TIMEOUT, billed: false, message: 'Scripted request cancelled.' } };
    if (outcome.startsWith('tool:')) return { ok: true, value: response(request, outcome) };
    const stream = /^stream:(\d+)$/u.exec(outcome);
    const text = outputText(request);
    const chunks = text.match(/.{1,12}/gu) ?? [text];
    if (stream !== null) {
      const count = Number(stream[1]);
      for (let index = 0; index < count; index += 1) onDelta?.(chunks[index % Math.max(1, chunks.length)] ?? 'x');
    } else if (outcome === 'ok' || outcome.startsWith('delay:')) {
      if (onDelta !== undefined) for (const chunk of chunks) onDelta(chunk);
    } else {
      if (onDelta !== undefined && outcome.startsWith('http:')) {
        const chunks = text.match(/.{1,12}/gu) ?? [text];
        onDelta(chunks.at(0) ?? 'partial');
        onDelta(chunks.at(1) ?? 'partial');
      }
      return failed(outcome);
    }
    return { ok: true, value: response(request, outcome) };
  };
  return {
    id,
    complete: (request, _apiKey, signal) => run(request, signal),
    stream: (request, _apiKey, signal, onDelta) => run(request, signal, onDelta),
    listModels: () => Promise.resolve({ ok: true, value: [] }),
  };
}

/** Every double an E2E sidecar uses; `sourceDir` is the composition root's folder (fixtures live beside it). */
export function createE2eDoubles(env: NodeJS.ProcessEnv, sourceDir: string) {
  const llmScripts =
    env.ITSTUDIO_E2E_LLM_SCRIPT !== undefined
      ? scriptedLlmFixtureSchema.parse(JSON.parse(readFileSync(env.ITSTUDIO_E2E_LLM_SCRIPT, 'utf8'))).models
      : {};
  const embeddingScripts =
    env.ITSTUDIO_E2E_EMBEDDING_SCRIPT !== undefined
      ? embeddingScriptSchema.parse(JSON.parse(readFileSync(env.ITSTUDIO_E2E_EMBEDDING_SCRIPT, 'utf8')))
      : {};
  const imageScripts =
    env.ITSTUDIO_E2E_IMAGE_SCRIPT !== undefined
      ? imageScriptSchema.parse(JSON.parse(readFileSync(env.ITSTUDIO_E2E_IMAGE_SCRIPT, 'utf8')))
      : {};
  const imageScriptCursors = new Map<string, number>();
  const embeddingScriptCursors = new Map<string, number>();
  const configuredLlmText = env.ITSTUDIO_E2E_LLM_TEXT ?? 'Scripted assistant reply.';
  const llmCapturePath = env.ITSTUDIO_E2E_LLM_CAPTURE;
  let llmTexts: string | Readonly<Record<string, string>> = configuredLlmText;
  try {
    const parsedText: unknown = JSON.parse(configuredLlmText) as unknown;
    const parsedTexts = scriptedLlmTextsSchema.safeParse(parsedText);
    if (parsedTexts.success) llmTexts = parsedTexts.data;
  } catch {
    // Plain response text remains the default fixture format.
  }
  const llmScriptCursors = new Map<string, number>();
  return {
    llmProvider: (id: ProviderId) => scriptedLlmProvider(id, llmTexts, llmScripts, llmScriptCursors, llmCapturePath),
    secretStore: new MemorySecretStore(),
    keyVerifier: (): IProviderKeyVerifier =>
      new ScriptedKeyVerifier(
        env.ITSTUDIO_E2E_VERIFIER_OUTCOME,
        env.ITSTUDIO_E2E_VERIFIER_FIXTURE ?? resolve(sourceDir, '../test/integration/fixtures/verifier.json'),
      ),
    fxHttp: (usdToVnd: number): IHttpClient => ({
      request: () => Promise.resolve(Response.json({ rates: { VND: usdToVnd } })),
    }),
    pricingHttp: {
      request: () => {
        if (env.ITSTUDIO_E2E_PRICING_HTTP === 'fail')
          return Promise.reject(new Error('Scripted pricing network failure.'));
        return Promise.resolve(
          new Response(readFileSync(resolve(sourceDir, '../test/fixtures/pricing/pricing.html'), 'utf8'), {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
        );
      },
    } satisfies IHttpClient,
    imageProviders: [
      new FakeImageProvider(ImageProviderId.OPENAI_DALLE3, imageScripts, imageScriptCursors),
      new FakeImageProvider(ImageProviderId.FLUX_TOGETHER, imageScripts, imageScriptCursors),
      new FakeImageProvider(ImageProviderId.FLUX_REPLICATE, imageScripts, imageScriptCursors),
    ],
    embeddingProvider: (id: ProviderId) => new FakeEmbeddingProvider(id, embeddingScripts, embeddingScriptCursors),
    browserLauncher: (logger: Logger): IBrowserLauncher => ({
      launch: (executable, url) => {
        let safeUrl = url;
        try {
          const parsedUrl = new URL(url);
          parsedUrl.search = '';
          parsedUrl.hash = '';
          safeUrl = parsedUrl.toString();
        } catch {
          // The launcher validates URLs before the E2E recorder receives them.
        }
        logger.info({ svc: 'webchat-e2e', executable, args: [safeUrl] }, 'Recorded browser launch request');
        return { ok: true, value: undefined };
      },
    }),
  };
}

export type E2eDoubles = ReturnType<typeof createE2eDoubles>;
