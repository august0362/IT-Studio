import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { conversationSchema, chatMessageSchema } from '../../src/validation/chat.js';
import { modelKeySchema, providerIdSchema } from '../../src/validation/common.js';
import { projectSchema } from '../../src/validation/projects.js';
import { llmRequestIdSchema } from '../../src/validation/brand.js';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';

let sidecar: SidecarHarness | undefined;
afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

const notificationSchema = z.object({ method: z.string(), params: z.unknown() });

async function setup(script: Readonly<Record<string, readonly string[]>> = {}, text = 'Scripted assistant reply.') {
  sidecar = await startSidecar({ ITSTUDIO_E2E_LLM_TEXT: text }, script);
  const workspace = resolve(sidecar.dataDir, 'chat-workspace');
  await mkdir(workspace);
  const projectResponse = await sidecar.call('project.create', { name: 'Chat test', workspaceRoot: workspace });
  const projectId = projectSchema.parse(projectResponse.result).id;
  const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
  const modelA = settings.router.ladder[0]?.modelKey ?? modelKeySchema.parse('google/gemini-3.8-flash');
  const modelB = settings.router.ladder[1]?.modelKey ?? modelKeySchema.parse('groq/llama-3.3-70b-versatile');
  for (const modelKey of [modelA, modelB]) {
    const provider = providerIdSchema.parse(modelKey.split('/')[0]);
    await sidecar.call('secrets.set', { provider, apiKey: `integration-only-${provider}-key` });
  }
  const created = await sidecar.call('chat.createConversation', { projectId });
  const conversationId = conversationSchema.parse(created.result).id;
  const notifications: z.infer<typeof notificationSchema>[] = [];
  sidecar.notifications.on('notification', (value: unknown) => {
    const parsed = notificationSchema.safeParse(value);
    if (parsed.success) notifications.push(parsed.data);
  });
  return { sidecar, projectId, conversationId, modelA, modelB, notifications };
}

function observed<T>(h: Awaited<ReturnType<typeof setup>>, method: string): T[] {
  return h.notifications
    .filter((notification) => notification.method === method)
    .map((notification) => notification.params as T);
}

async function completed(h: Awaited<ReturnType<typeof setup>>, count = 1): Promise<void> {
  await waitFor(() => observed(h, 'chat.completed').length === count);
}

describe('chat integration', () => {
  it('TC-M2-010 streams three deltas then completion over stdio', async () => {
    const h = await setup({ 'google/gemini-3.8-flash': ['stream:3'] }, 'three stream chunks');
    await h.sidecar.call('chat.send', { conversationId: h.conversationId, text: 'hello' });
    await completed(h);
    expect(observed(h, 'chat.delta')).toHaveLength(3);
    expect(h.notifications.at(-1)?.method).toBe('chat.completed');
  });

  it('TC-M2-011 discards partial output before falling back', async () => {
    // 503 is retryable (ARCH §5.2): 1 attempt + maxRetries(2) must all fail mid-stream before the router falls back.
    const h = await setup({ 'google/gemini-3.8-flash': ['http:503', 'http:503', 'http:503'] });
    await h.sidecar.call('chat.send', { conversationId: h.conversationId, text: 'fallback' });
    await completed(h);
    const fallbackIndex = h.notifications.findIndex((notification) => {
      if (notification.method !== 'router.event') return false;
      const parsed = z.object({ type: z.string() }).safeParse(notification.params);
      return parsed.success && parsed.data.type === 'fallback';
    });
    expect(fallbackIndex).toBeGreaterThanOrEqual(0);
    expect(
      h.notifications
        .slice(fallbackIndex + 1)
        .filter((notification) => notification.method === 'chat.delta')
        .map((notification) => (notification.params as { textDelta: string }).textDelta)
        .join(''),
    ).toBe('Scripted assistant reply.');
    expect(
      observed<{ message: { parts: { text?: string }[] } }>(h, 'chat.completed')[0]
        ?.message.parts.map((part) => part.text ?? '')
        .join(''),
    ).toBe('Scripted assistant reply.');
  });

  it('TC-M2-012 cancels a delayed stream without persisting an assistant message', async () => {
    const h = await setup({ 'google/gemini-3.8-flash': ['delay:30000'] });
    const sent = await h.sidecar.call('chat.send', { conversationId: h.conversationId, text: 'cancel me' });
    const requestId = llmRequestIdSchema.parse(z.object({ requestId: z.uuid() }).parse(sent.result).requestId);
    await waitFor(() =>
      observed<{ state: string; modelKey?: string }>(h, 'router.event').some(
        (event) => event.state === 'dispatching' && event.modelKey === h.modelA,
      ),
    );
    const cancelled = await h.sidecar.call('chat.cancel', { requestId });
    expect(cancelled.result).toMatchObject({ cancelled: true });
    await waitFor(() => observed(h, 'chat.failed').length === 1);
    const messages = chatMessageSchema
      .array()
      .parse((await h.sidecar.call('chat.getMessages', { conversationId: h.conversationId })).result);
    expect(messages.map((message) => message.role)).toEqual(['user']);
  });

  it('TC-M2-013 reports content filtering without falling back', async () => {
    const h = await setup({ 'google/gemini-3.8-flash': ['content_filter'] });
    await h.sidecar.call('chat.send', { conversationId: h.conversationId, text: 'filtered prompt' });
    await waitFor(() => observed(h, 'chat.failed').length === 1);
    expect(JSON.stringify(observed(h, 'chat.failed'))).toContain('PROVIDER_CONTENT_FILTERED');
    expect(observed(h, 'chat.completed')).toHaveLength(0);
  });

  it('TC-M2-040 persists conversation messages across a sidecar restart', async () => {
    const h = await setup({}, 'survives restart');
    await h.sidecar.call('chat.send', { conversationId: h.conversationId, text: 'persist this' });
    await completed(h);
    await h.sidecar.restart();
    const messages = chatMessageSchema
      .array()
      .parse((await h.sidecar.call('chat.getMessages', { conversationId: h.conversationId })).result);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[1]?.parts).toContainEqual({ type: 'text', text: 'survives restart' });
  });

  it('TC-M2-041 rejects a second send while the conversation is busy', async () => {
    const h = await setup({ 'google/gemini-3.8-flash': ['delay:30000'] });
    const first = await h.sidecar.call('chat.send', { conversationId: h.conversationId, text: 'first' });
    expect(first.error).toBeUndefined();
    await waitFor(() =>
      observed<{ state: string; modelKey?: string }>(h, 'router.event').some(
        (event) => event.state === 'dispatching' && event.modelKey === h.modelA,
      ),
    );
    const second = await h.sidecar.call('chat.send', { conversationId: h.conversationId, text: 'second' });
    expect(JSON.stringify(second.error)).toContain('CONFLICT');
    const requestId = llmRequestIdSchema.parse(z.object({ requestId: z.uuid() }).parse(first.result).requestId);
    await h.sidecar.call('chat.cancel', { requestId });
    await waitFor(() => observed(h, 'chat.failed').length === 1);
  });

  it('TC-M2-042 completes two conversations independently', async () => {
    const h = await setup({ 'google/gemini-3.8-flash': ['delay:50', 'delay:50'] });
    const second = conversationSchema.parse(
      (await h.sidecar.call('chat.createConversation', { projectId: h.projectId })).result,
    ).id;
    await Promise.all([
      h.sidecar.call('chat.send', { conversationId: h.conversationId, text: 'first stream' }),
      h.sidecar.call('chat.send', { conversationId: second, text: 'second stream' }),
    ]);
    await completed(h, 2);
    const messagesA = chatMessageSchema
      .array()
      .parse((await h.sidecar.call('chat.getMessages', { conversationId: h.conversationId })).result);
    const messagesB = chatMessageSchema
      .array()
      .parse((await h.sidecar.call('chat.getMessages', { conversationId: second })).result);
    expect(messagesA.map((message) => message.parts)).toContainEqual([{ type: 'text', text: 'first stream' }]);
    expect(messagesB.map((message) => message.parts)).toContainEqual([{ type: 'text', text: 'second stream' }]);
  });

  it('TC-M2-043 auto-titles from the first prompt with one provider dispatch', async () => {
    const h = await setup({ 'google/gemini-3.8-flash': ['ok'] });
    const prompt = 'A'.repeat(65);
    await h.sidecar.call('chat.send', { conversationId: h.conversationId, text: prompt });
    await completed(h);
    const conversations = z
      .array(conversationSchema)
      .parse((await h.sidecar.call('chat.listConversations', { projectId: h.projectId })).result);
    expect(conversations[0]?.title).toBe(prompt.slice(0, 60));
    const dispatches = observed<{ state: string; modelKey?: string }>(h, 'router.event').filter(
      (event) => event.state === 'dispatching' && event.modelKey === h.modelA,
    );
    expect(dispatches).toHaveLength(1);
  });

  it('TC-M2-050 does not expose provider keys in stdio, logs, or persisted chat data', async () => {
    const h = await setup({}, 'safe response');
    await h.sidecar.call('chat.send', { conversationId: h.conversationId, text: 'secret scan' });
    await completed(h);
    const files = await readdir(h.sidecar.dataDir, { recursive: true });
    const persisted = await Promise.all(
      files.map(async (file) => {
        try {
          return await readFile(resolve(h.sidecar.dataDir, file), 'utf8');
        } catch {
          return '';
        }
      }),
    );
    const output = `${h.sidecar.stdoutLines.join('\n')}${h.sidecar.stderr.join('\n')}${persisted.join('\n')}`;
    expect(output).not.toContain('integration-only-google-key');
    expect(output).not.toContain('integration-only-groq-key');
  });

  it('TC-M2-051 sanitizes provider error details before they reach chat.failed', async () => {
    const h = await setup({ 'google/gemini-3.8-flash': ['http:503'] });
    const fakeProviderErrorKey = ['sk', 'fake', 'provider', 'error', 'body'].join('-');
    const settings = appSettingsSchema.parse((await h.sidecar.call('settings.get')).result);
    await h.sidecar.call('router.updateConfig', {
      config: {
        ...settings.router,
        ladder: settings.router.ladder.slice(0, 1).map((entry) => ({ ...entry, maxRetries: 0 })),
      },
    });
    await h.sidecar.call('chat.send', { conversationId: h.conversationId, text: 'error body check' });
    await waitFor(() => observed(h, 'chat.failed').length === 1);
    expect(JSON.stringify(h.sidecar.stdoutLines)).not.toContain(fakeProviderErrorKey);
    expect(JSON.stringify(h.sidecar.stderr)).not.toContain(fakeProviderErrorKey);
    expect(JSON.stringify(h.notifications)).not.toContain(fakeProviderErrorKey);
  });
});
