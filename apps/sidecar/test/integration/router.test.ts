import { afterEach, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { conversationSchema } from '../../src/validation/chat.js';
import { modelKeySchema, providerIdSchema } from '../../src/validation/common.js';
import { projectSchema } from '../../src/validation/projects.js';
import { routerConfigSchema } from '../../src/validation/router.js';
import { llmRequestIdSchema } from '../../src/validation/brand.js';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';

let sidecar: SidecarHarness | undefined;
afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

const rpcErrorSchema = z.object({ code: z.number(), message: z.string(), data: z.unknown().optional() });
const notificationSchema = z.object({ method: z.string(), params: z.unknown() });

async function setup(script: Readonly<Record<string, readonly string[]>> = {}) {
  sidecar = await startSidecar({}, script);
  const workspace = `${sidecar.dataDir}/router-workspace`;
  await mkdir(workspace);
  const projectResponse = await sidecar.call('project.create', { name: 'Router test', workspaceRoot: workspace });
  const projectId = projectSchema.parse(projectResponse.result).id;
  const settingsResponse = await sidecar.call('settings.get');
  const settings = appSettingsSchema.parse(settingsResponse.result);
  const modelA = settings.router.ladder[0]?.modelKey ?? modelKeySchema.parse('google/gemini-3.8-flash');
  const modelB = settings.router.ladder[1]?.modelKey ?? modelKeySchema.parse('groq/llama-3.3-70b-versatile');
  const ladder = [modelA, modelB];
  const config = {
    ...settings.router,
    ladder: ladder.map((modelKey, index) => ({
      modelKey,
      priority: index + 1,
      enabled: true,
      maxRetries: 0,
      timeoutMs: 30_000,
    })),
    lockedModelKey: null,
    autoFallback: true,
    userDecisionTimeoutMs: 10_000,
  };
  const configured = await sidecar.call('router.updateConfig', { config });
  expect(configured.error).toBeUndefined();
  for (const modelKey of ladder) {
    const provider = providerIdSchema.parse(modelKey.split('/')[0]);
    await sidecar.call('secrets.set', { provider, apiKey: `fixture-key-${provider}` });
  }
  const conversationResponse = await sidecar.call('chat.createConversation', { projectId });
  const conversationId = conversationSchema.parse(conversationResponse.result).id;
  const events: z.infer<typeof notificationSchema>[] = [];
  sidecar.notifications.on('notification', (value: unknown) => {
    const parsed = notificationSchema.safeParse(value);
    if (parsed.success) events.push(parsed.data);
  });
  return { sidecar, modelA, modelB, ladder, config, projectId, conversationId, events };
}

async function send(h: Awaited<ReturnType<typeof setup>>, text = 'test') {
  const result = await h.sidecar.call('chat.send', { conversationId: h.conversationId, text });
  expect(result.error).toBeUndefined();
  return result;
}

function params<T>(h: Awaited<ReturnType<typeof setup>>, method: string): T[] {
  return h.events.filter((event) => event.method === method).map((event) => event.params as T);
}

function failedAttempts(h: Awaited<ReturnType<typeof setup>>) {
  return params<{ attempt: { modelKey: string; failure?: string } }>(h, 'router.event')
    .filter((event) => 'attempt' in event)
    .map((event) => event.attempt);
}

describe('router integration', () => {
  it('TC-M2-001 succeeds on the first model without fallback', async () => {
    const h = await setup();
    await send(h);
    await waitFor(() => params(h, 'chat.completed').length === 1);
    const completion = params<{ message: { modelKey: string } }>(h, 'chat.completed')[0];
    expect(completion?.message.modelKey).toBe(h.modelA);
    expect(params(h, 'router.event').some((event) => JSON.stringify(event).includes('fallback'))).toBe(false);
  });

  it('TC-M2-002 retries a transient server error on the same model', async () => {
    const h = await setup({ [hModel('google/gemini-3.8-flash')]: ['http:503:0', 'ok'] });
    await h.sidecar.call('router.updateConfig', {
      config: {
        ...h.config,
        ladder: h.config.ladder.map((entry, index) => ({ ...entry, maxRetries: index === 0 ? 1 : 0 })),
      },
    });
    await send(h);
    await waitFor(() => params(h, 'chat.completed').length === 1);
    expect(params<{ state: string }>(h, 'router.event').some((event) => event.state === 'retry_wait')).toBe(true);
    expect(failedAttempts(h).filter((attempt) => attempt.modelKey === h.modelA)).toHaveLength(1);
  });

  it('TC-M2-003 falls back after a long Retry-After', async () => {
    const h = await setup({ [hModel('google/gemini-3.8-flash')]: ['http:429:30000'] });
    await send(h);
    await waitFor(() => params(h, 'chat.completed').length === 1);
    expect(params(h, 'router.event')).toContainEqual(
      expect.objectContaining({
        type: 'fallback',
        from: h.modelA,
        to: h.modelB,
        reason: 'rate_limited',
      }),
    );
  });

  it('TC-M2-004 opens the quota circuit and skips the first model on the next request', async () => {
    const h = await setup({ [hModel('google/gemini-3.8-flash')]: ['quota'] });
    await h.sidecar.call('router.updateConfig', {
      config: { ...h.config, circuitBreaker: { ...h.config.circuitBreaker, failureThreshold: 1 } },
    });
    await send(h, 'first');
    await waitFor(() => params(h, 'chat.completed').length === 1);
    await send(h, 'second');
    await waitFor(() => params(h, 'chat.completed').length === 2);
    const events = params<{ type: string; modelKey?: string; status?: string; state?: string }>(h, 'router.event');
    expect(events).toContainEqual({ type: 'circuit', modelKey: h.modelA, status: 'open' });
    expect(
      events.filter((event) => event.type === 'state' && event.state === 'dispatching' && event.modelKey === h.modelA),
    ).toHaveLength(1);
  });

  it('TC-M2-005 fails fast on provider authentication errors', async () => {
    const h = await setup({ [hModel('google/gemini-3.8-flash')]: ['auth'] });
    await send(h);
    await waitFor(() => params(h, 'chat.failed').length === 1);
    expect(JSON.stringify(params(h, 'chat.failed'))).toContain('PROVIDER_AUTH');
    expect(params<{ from: string }>(h, 'router.event').some((event) => event.from === h.modelA)).toBe(false);
  });

  it('TC-M2-006 reports every model after exhausting the ladder', async () => {
    const h = await setup({
      [hModel('google/gemini-3.8-flash')]: ['http:503:0', 'http:503:0', 'http:503:0'],
      [hModel('groq/llama-3.3-70b-versatile')]: ['http:503:0', 'http:503:0', 'http:503:0'],
    });
    const config = { ...h.config, ladder: h.config.ladder.map((entry) => ({ ...entry, maxRetries: 2 })) };
    await h.sidecar.call('router.updateConfig', { config });
    await send(h);
    await waitFor(() => params(h, 'chat.failed').length === 1);
    expect(JSON.stringify(params(h, 'chat.failed'))).toContain(h.modelA);
    expect(JSON.stringify(params(h, 'chat.failed'))).toContain(h.modelB);
  });

  it('TC-M2-007 asks for a user fallback decision and uses the selected model', async () => {
    const h = await setup({ [hModel('google/gemini-3.8-flash')]: ['http:429:30000'] });
    await h.sidecar.call('router.updateConfig', { config: { ...h.config, autoFallback: false } });
    await send(h);
    await waitFor(() => params(h, 'router.fallbackRequired').length === 1);
    const required = params<{
      requestId: string;
      candidates: { modelKey: string; estimatedCostMicroUsd: number }[];
    }>(h, 'router.fallbackRequired')[0];
    expect(required?.candidates.map((candidate) => candidate.modelKey)).toContain(h.modelB);
    expect(required?.candidates.every((candidate) => typeof candidate.estimatedCostMicroUsd === 'number')).toBe(true);
    await h.sidecar.call('router.resolveFallback', {
      requestId: llmRequestIdSchema.parse(required?.requestId),
      action: 'use_model',
      modelKey: h.modelB,
    });
    await waitFor(() => params(h, 'chat.completed').length === 1);
    expect(params<{ message: { modelKey: string } }>(h, 'chat.completed')[0]?.message.modelKey).toBe(h.modelB);
  });

  it('TC-M2-008 aborts when the user declines fallback', async () => {
    const h = await setup({ [hModel('google/gemini-3.8-flash')]: ['http:429:30000'] });
    await h.sidecar.call('router.updateConfig', { config: { ...h.config, autoFallback: false } });
    await send(h);
    await waitFor(() => params(h, 'router.fallbackRequired').length === 1);
    const required = params<{ requestId: string }>(h, 'router.fallbackRequired')[0];
    await h.sidecar.call('router.resolveFallback', {
      requestId: llmRequestIdSchema.parse(required?.requestId),
      action: 'abort',
    });
    await waitFor(() => params(h, 'chat.failed').length === 1);
    expect(JSON.stringify(params(h, 'chat.failed'))).toContain('FALLBACK_DECLINED');
  });

  it('TC-M2-009 declines fallback when the minimum decision timeout expires', async () => {
    const h = await setup({ [hModel('google/gemini-3.8-flash')]: ['http:429:30000'] });
    await h.sidecar.call('router.updateConfig', { config: { ...h.config, autoFallback: false } });
    await send(h);
    await waitFor(() => params(h, 'chat.failed').length === 1, 15_000);
    expect(JSON.stringify(params(h, 'chat.failed'))).toContain('FALLBACK_DECLINED');
  }, 20_000);

  it('TC-M2-020 applies the Retry-After retry threshold at 9999, 10000, and 10001 ms', async () => {
    for (const retryAfterMs of [9999, 10000, 10001]) {
      const h = await setup({ [hModel('google/gemini-3.8-flash')]: [`http:429:${String(retryAfterMs)}`, 'ok'] });
      const config = { ...h.config, ladder: h.config.ladder.map((entry) => ({ ...entry, maxRetries: 1 })) };
      await h.sidecar.call('router.updateConfig', { config });
      await send(h, String(retryAfterMs));
      await waitFor(() => params(h, 'chat.completed').length === 1);
      expect(failedAttempts(h).filter((attempt) => attempt.modelKey === h.modelA)).toHaveLength(1);
      if (retryAfterMs <= 10_000)
        expect(params<{ message: { modelKey: string } }>(h, 'chat.completed')[0]?.message.modelKey).toBe(h.modelA);
      else expect(params<{ message: { modelKey: string } }>(h, 'chat.completed')[0]?.message.modelKey).toBe(h.modelB);
      await h.sidecar.close();
      sidecar = undefined;
    }
  });

  it('TC-M2-021 honors configured retry counts of zero, two, and five', async () => {
    for (const retries of [0, 2, 5]) {
      const h = await setup({
        [hModel('google/gemini-3.8-flash')]: Array.from({ length: retries + 1 }, () => 'http:503:0'),
      });
      const config = {
        ...h.config,
        circuitBreaker: { ...h.config.circuitBreaker, failureThreshold: retries + 2 },
        ladder: h.config.ladder.map((entry, index) => ({ ...entry, maxRetries: index === 0 ? retries : 0 })),
      };
      await h.sidecar.call('router.updateConfig', { config });
      await send(h, String(retries));
      await waitFor(() => params(h, 'chat.completed').length === 1);
      expect(failedAttempts(h).filter((attempt) => attempt.modelKey === h.modelA)).toHaveLength(retries + 1);
      await h.sidecar.close();
      sidecar = undefined;
    }
  });

  it('TC-M2-022 rejects invalid router configs without changing stored config', async () => {
    const h = await setup();
    for (const invalid of [
      { ...h.config, ladder: h.config.ladder.map((entry) => ({ ...entry, priority: 1 })) },
      { ...h.config, ladder: h.config.ladder.map((entry) => ({ ...entry, maxRetries: 6 })) },
      { ...h.config, ladder: h.config.ladder.map((entry) => ({ ...entry, timeoutMs: 4_999 })) },
      { ...h.config, ladder: h.config.ladder.map((entry) => ({ ...entry, timeoutMs: 300_001 })) },
      { ...h.config, userDecisionTimeoutMs: 9_999 },
    ]) {
      const before = routerConfigSchema.parse((await h.sidecar.call('router.getConfig')).result);
      const response = await h.sidecar.call('router.updateConfig', { config: invalid });
      expect(rpcErrorSchema.parse(response.error).data).toMatchObject({ code: 'VALIDATION' });
      expect(routerConfigSchema.parse((await h.sidecar.call('router.getConfig')).result)).toEqual(before);
    }
  });

  it('TC-M2-030 puts a locked model first', async () => {
    const h = await setup();
    await h.sidecar.call('router.updateConfig', { config: { ...h.config, lockedModelKey: h.modelB } });
    await send(h);
    await waitFor(() => params(h, 'chat.completed').length === 1);
    expect(params<{ message: { modelKey: string } }>(h, 'chat.completed')[0]?.message.modelKey).toBe(h.modelB);
  });

  it('TC-M2-031 skips a model without an API key', async () => {
    const h = await setup();
    await h.sidecar.call('secrets.delete', { provider: providerIdSchema.parse(h.modelA.split('/')[0]) });
    await send(h);
    await waitFor(() => params(h, 'chat.completed').length === 1);
    expect(params<{ message: { modelKey: string } }>(h, 'chat.completed')[0]?.message.modelKey).toBe(h.modelB);
  });

  it('TC-M2-032 never tries a disabled ladder model', async () => {
    const h = await setup();
    await h.sidecar.call('router.updateConfig', {
      config: { ...h.config, ladder: h.config.ladder.map((entry, index) => ({ ...entry, enabled: index !== 0 })) },
    });
    await send(h);
    await waitFor(() => params(h, 'chat.completed').length === 1);
    expect(params<{ message: { modelKey: string } }>(h, 'chat.completed')[0]?.message.modelKey).toBe(h.modelB);
  });

  it('TC-M2-033 lists Gemini models as eligible', async () => {
    const h = await setup();
    const models = z
      .array(z.object({ key: modelKeySchema, provider: z.string(), enabled: z.boolean() }))
      .parse((await h.sidecar.call('models.list')).result);
    expect(models.some((model) => model.provider === 'google' && model.enabled)).toBe(true);
  });
});

function hModel(modelKey: string): string {
  return modelKey;
}
