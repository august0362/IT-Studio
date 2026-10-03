import { afterEach, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { chatMessageSchema, conversationSchema } from '../../src/validation/chat.js';
import { modelKeySchema } from '../../src/validation/common.js';
import { projectSchema } from '../../src/validation/projects.js';
import { microUsd } from '../../src/domain/money.js';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';

let sidecar: SidecarHarness | undefined;
afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

const notificationSchema = z.object({ method: z.string(), params: z.unknown() });

async function setup(script: Readonly<Record<string, readonly string[]>>) {
  sidecar = await startSidecar({}, script);
  const workspace = resolve(sidecar.dataDir, 'image-workspace');
  await mkdir(workspace);
  const projectId = projectSchema.parse(
    (await sidecar.call('project.create', { name: 'Image test', workspaceRoot: workspace })).result,
  ).id;
  const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
  const modelKey = settings.router.ladder[0]?.modelKey ?? modelKeySchema.parse('google/gemini-3.8-flash');
  const enabled = await sidecar.call('settings.update', { patch: { image: { ...settings.image, enabled: true } } });
  expect(enabled.error).toBeUndefined();
  const provider = modelKey.split('/')[0];
  await sidecar.call('secrets.set', {
    provider: z.enum(['anthropic', 'openai', 'google', 'xai', 'groq', 'together', 'replicate']).parse(provider),
    apiKey: 'integration-only-key',
  });
  const conversationId = conversationSchema.parse(
    (await sidecar.call('chat.createConversation', { projectId })).result,
  ).id;
  const notifications: z.infer<typeof notificationSchema>[] = [];
  sidecar.notifications.on('notification', (value: unknown) => {
    const parsed = notificationSchema.safeParse(value);
    if (parsed.success) notifications.push(parsed.data);
  });
  return { sidecar, projectId, conversationId, modelKey, notifications };
}

function observed<T>(h: Awaited<ReturnType<typeof setup>>, method: string): T[] {
  return h.notifications.filter((item) => item.method === method).map((item) => item.params as T);
}

describe('image generation integration', () => {
  it('TC-M8-001 stores the scripted image, lists its asset, records image cost, and attaches it to chat', async () => {
    const key = 'google/gemini-3.8-flash';
    const h = await setup({ [key]: ['tool:{"name":"generate_image","arguments":{"prompt":"a blue bird"}}'] });
    await h.sidecar.call('chat.send', { conversationId: h.conversationId, text: 'Generate a blue bird image' });
    await waitFor(() => observed(h, 'chat.completed').length === 1);
    const assets = z
      .array(z.object({ id: z.string(), localPath: z.string(), mimeType: z.string() }))
      .parse((await h.sidecar.call('images.list', { projectId: h.projectId })).result);
    expect(assets).toHaveLength(1);
    const asset = assets[0];
    if (asset === undefined) throw new Error('Generated image asset was missing.');
    expect(asset.localPath).toContain(resolve(h.sidecar.dataDir, 'images', h.projectId));
    const ledger = z
      .object({ items: z.array(z.object({ purpose: z.string(), imageCount: z.number().optional() })) })
      .parse((await h.sidecar.call('ledger.query', { projectId: h.projectId, limit: 50 })).result);
    expect(ledger.items).toContainEqual(expect.objectContaining({ purpose: 'image', imageCount: 1 }));
    const messages = chatMessageSchema
      .array()
      .parse((await h.sidecar.call('chat.getMessages', { conversationId: h.conversationId })).result);
    expect(messages.flatMap((message) => message.parts)).toContainEqual({
      type: 'image',
      assetId: asset.id,
      mimeType: asset.mimeType,
    });
  });

  it('TC-M8-002 blocks a Hard Stop before calling the fake image provider or writing a file', async () => {
    const key = 'google/gemini-3.8-flash';
    const h = await setup({ [key]: ['tool:{"name":"generate_image","arguments":{"prompt":"blocked"}}'] });
    await h.sidecar.call('pricing.override', {
      entry: {
        modelKey: 'openai/gpt-5.5',
        inputPerMTokMicroUsd: microUsd(5_000_000),
        outputPerMTokMicroUsd: microUsd(30_000_000),
        cachedInputPerMTokMicroUsd: microUsd(500_000),
        perImageMicroUsd: microUsd(2),
        freeTier: false,
        sourceUrl: 'https://openai.com/api/pricing/',
      },
    });
    await h.sidecar.call('budget.set', {
      projectId: h.projectId,
      period: 'project_lifetime',
      limitMicroUsd: microUsd(1),
      warnAt: [1],
    });
    const settings = appSettingsSchema.parse((await h.sidecar.call('settings.get')).result);
    await h.sidecar.call('settings.update', { patch: { budget: { hardStop: true }, image: settings.image } });
    await h.sidecar.call('chat.send', { conversationId: h.conversationId, text: 'Generate an image' });
    await waitFor(() => observed(h, 'chat.failed').length === 1);
    expect(JSON.stringify(observed(h, 'chat.failed'))).toContain('BUDGET_HARD_STOP');
    expect((await h.sidecar.call('images.list', { projectId: h.projectId })).result).toEqual([]);
  });
});
