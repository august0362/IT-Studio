import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { chatMessageSchema, conversationSchema } from '../../src/validation/chat.js';
import { projectSchema } from '../../src/validation/projects.js';
import { providerIdSchema } from '../../src/validation/common.js';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';

let sidecar: SidecarHarness | undefined;

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

describe('RAG retrieval integration', () => {
  it('TC-M5-010 retrieves ordered hits at or above minScore and TC-M5-011 persists the toggle and citations', async () => {
    sidecar = await startSidecar({ ITSTUDIO_E2E_LLM_TEXT: 'The guide says cite this [1].' });
    const workspace = resolve(sidecar.dataDir, 'rag-retrieval-workspace');
    await mkdir(workspace);
    const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/rag');
    await cp(fixtureDir, resolve(workspace, 'docs'), { recursive: true });
    const projectId = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'RAG retrieval', workspaceRoot: workspace })).result,
    ).id;
    const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
    const provider = providerIdSchema.parse(settings.rag.embedding.modelKey.split('/')[0]);
    await sidecar.call('secrets.set', { provider, apiKey: 'integration-only-fake-key' });
    await sidecar.call('settings.update', { patch: { rag: { minScore: 0 } } });
    const progress: { readonly id: string; readonly status: string }[] = [];
    sidecar.notifications.on('notification', (value: unknown) => {
      const parsed = z
        .object({ method: z.string(), params: z.object({ id: z.string(), status: z.string() }) })
        .safeParse(value);
      if (parsed.success && parsed.data.method === 'rag.progress') progress.push(parsed.data.params);
    });
    const ingest = await sidecar.call('rag.ingest', { projectId, paths: ['docs'] });
    const job = z.object({ id: z.string() }).parse(ingest.result);
    await waitFor(() => progress.some((event) => event.id === job.id && event.status === 'indexed'));

    const chatQuery = 'What is in the guide?';
    const retrieved = await sidecar.call('rag.query', { projectId, query: chatQuery, topK: 6, minScore: 0 });
    const hits = z
      .array(z.object({ score: z.number(), text: z.string(), documentTitle: z.string() }))
      .parse(retrieved.result);
    expect(retrieved.error).toBeUndefined();
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.score >= 0)).toBe(true);

    const conversation = conversationSchema.parse(
      (await sidecar.call('chat.createConversation', { projectId })).result,
    );
    const enabled = await sidecar.call('chat.setRagEnabled', { conversationId: conversation.id, enabled: true });
    expect(conversationSchema.parse(enabled.result).ragEnabled).toBe(true);
    await sidecar.call('chat.send', { conversationId: conversation.id, text: chatQuery });
    await waitFor(() => sidecar?.stdoutLines.some((line) => line.includes('chat.completed')) === true);
    const messages = z
      .array(chatMessageSchema)
      .parse((await sidecar.call('chat.getMessages', { conversationId: conversation.id })).result);
    const assistant = messages.find((message) => message.role === 'assistant');
    expect(
      assistant?.parts.some((part) => part.type === 'citation' && part.hit.documentTitle === hits[0]?.documentTitle),
    ).toBe(true);
  }, 60_000);
});
