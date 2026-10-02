import { afterEach, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { modelKeySchema, providerIdSchema } from '../../src/validation/common.js';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { projectSchema } from '../../src/validation/projects.js';
import { conversationSchema } from '../../src/validation/chat.js';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';

let sidecar: SidecarHarness | undefined;

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

describe('ledger integration', () => {
  it('TC-M3-001 records one scripted chat completion visible through ledger.query over stdio', async () => {
    sidecar = await startSidecar({ ITSTUDIO_E2E_LLM_TEXT: 'Ledger integration reply.' });
    const workspace = resolve(sidecar.dataDir, 'ledger-workspace');
    await mkdir(workspace);
    const createdProject = await sidecar.call('project.create', { name: 'Ledger test', workspaceRoot: workspace });
    const projectId = projectSchema.parse(createdProject.result).id;
    const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
    const firstKey = modelKeySchema.parse(settings.router.ladder[0]?.modelKey);
    const provider = providerIdSchema.parse(firstKey.split('/')[0]);
    await sidecar.call('secrets.set', { provider, apiKey: 'integration-only-scripted-key' });
    const conversationId = conversationSchema.parse(
      (await sidecar.call('chat.createConversation', { projectId })).result,
    ).id;
    const notifications: string[] = [];
    sidecar.notifications.on('notification', (value: unknown) => {
      if (typeof value === 'object' && value !== null && 'method' in value && typeof value.method === 'string')
        notifications.push(value.method);
    });
    await sidecar.call('chat.send', { conversationId, text: 'record this cost' });
    await waitFor(() => notifications.includes('ledger.entry') && notifications.includes('chat.completed'));
    const page = await sidecar.call('ledger.query', { projectId, limit: 10 });
    expect(page.error).toBeUndefined();
    const result = page.result as { readonly items?: readonly unknown[] } | undefined;
    expect(result?.items).toHaveLength(1);
    expect(notifications.filter((method) => method === 'ledger.entry')).toHaveLength(1);
  }, 30_000);
});
