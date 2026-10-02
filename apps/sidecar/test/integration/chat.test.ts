import { afterEach, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { modelKeySchema, providerIdSchema } from '../../src/validation/common.js';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { projectSchema } from '../../src/validation/projects.js';
import { conversationSchema } from '../../src/validation/chat.js';
import { z } from 'zod';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';

let sidecar: SidecarHarness | undefined;

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

describe('chat integration', () => {
  it('TC-M2-010 streams deltas then completion over stdio using the scripted provider', async () => {
    sidecar = await startSidecar({ ITSTUDIO_E2E_LLM_TEXT: 'Scripted assistant reply.' });
    const workspace = resolve(sidecar.dataDir, 'chat-workspace');
    await mkdir(workspace);
    const project = await sidecar.call('project.create', { name: 'Chat test', workspaceRoot: workspace });
    const projectId = projectSchema.parse(project.result).id;
    const settings = await sidecar.call('settings.get');
    const ladder = appSettingsSchema.parse(settings.result).router.ladder;
    const firstKey = modelKeySchema.parse(ladder[0]?.modelKey);
    const provider = providerIdSchema.parse(firstKey.split('/')[0]);
    await sidecar.call('secrets.set', { provider, apiKey: 'integration-only-scripted-key' });
    const created = await sidecar.call('chat.createConversation', { projectId });
    const conversationId = conversationSchema.parse(created.result).id;
    const notifications: { method: string; params: unknown }[] = [];
    sidecar.notifications.on('notification', (value: unknown) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        'method' in value &&
        'params' in value &&
        typeof value.method === 'string'
      ) {
        notifications.push({ method: value.method, params: value.params });
      }
    });
    const sent = await sidecar.call('chat.send', { conversationId, text: 'hello' });
    const sendResult = z.object({ requestId: z.uuid(), userMessageId: z.uuid() }).parse(sent.result);
    expect(sendResult.requestId.length).toBeGreaterThan(0);
    await waitFor(() => notifications.some((item) => item.method === 'chat.completed'));
    expect(notifications.filter((item) => item.method === 'chat.delta').length).toBeGreaterThan(0);
    expect(notifications.at(-1)?.method).toBe('chat.completed');
  }, 30_000);
});
