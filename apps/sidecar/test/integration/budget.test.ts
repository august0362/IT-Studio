import { afterEach, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { conversationSchema } from '../../src/validation/chat.js';
import { projectSchema } from '../../src/validation/projects.js';
import { ledgerEntrySchema } from '../../src/validation/cost.js';
import { microUsdSchema } from '../../src/validation/brand.js';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';

let sidecar: SidecarHarness | undefined;

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

describe('budget integration', () => {
  it('TC-M3-030 blocks paid chat calls with Hard Stop and warns while allowing calls when disabled', async () => {
    sidecar = await startSidecar({ ITSTUDIO_E2E_LLM_TEXT: 'Budget integration reply.' });
    const workspace = resolve(sidecar.dataDir, 'budget-workspace');
    await mkdir(workspace);
    const projectId = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'Budget test', workspaceRoot: workspace })).result,
    ).id;
    const conversationId = conversationSchema.parse(
      (await sidecar.call('chat.createConversation', { projectId })).result,
    ).id;
    // Scripted providers still require a configured key to be eligible (ARCH §5.3).
    for (const provider of ['google', 'groq'] as const) {
      await sidecar.call('secrets.set', { provider, apiKey: `integration-only-${provider}-key` });
    }
    const notifications: { readonly method: string; readonly params: unknown }[] = [];
    sidecar.notifications.on('notification', (value: unknown) => {
      const parsed = z.object({ method: z.string(), params: z.unknown() }).safeParse(value);
      if (parsed.success) notifications.push(parsed.data);
    });

    await sidecar.call('budget.set', {
      projectId,
      period: 'monthly',
      limitMicroUsd: microUsdSchema.parse(1),
      warnAt: [1],
    });
    await sidecar.call('settings.update', { patch: { budget: { hardStop: true } } });
    const blocked = await sidecar.call('chat.send', { conversationId, text: 'blocked call' });
    expect(blocked.error).toBeUndefined();
    await waitFor(() => notifications.some((notification) => notification.method === 'chat.failed'));
    const failure = notifications.find((notification) => notification.method === 'chat.failed');
    expect(JSON.stringify(failure)).toContain('BUDGET_HARD_STOP');
    const dispatchEvents = notifications.filter(
      (notification) =>
        notification.method === 'router.event' && JSON.stringify(notification.params).includes('dispatching'),
    );
    expect(dispatchEvents).toHaveLength(0);
    const emptyLedger = await sidecar.call('ledger.query', { projectId, limit: 10 });
    expect(z.object({ items: z.array(ledgerEntrySchema) }).parse(emptyLedger.result).items).toHaveLength(0);

    await sidecar.call('settings.update', { patch: { budget: { hardStop: false } } });
    await sidecar.call('chat.send', { conversationId, text: 'allowed with warning' });
    await waitFor(() => notifications.some((notification) => notification.method === 'chat.completed'));
    const exceededAlert = notifications.find(
      (notification) =>
        notification.method === 'budget.alert' && JSON.stringify(notification.params).includes('exceeded'),
    );
    expect(exceededAlert).toBeDefined();
    const ledger = await sidecar.call('ledger.query', { projectId, limit: 10 });
    expect(z.object({ items: z.array(ledgerEntrySchema) }).parse(ledger.result).items).toHaveLength(1);
    const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
    expect(settings.budget.hardStop).toBe(false);
  }, 30_000);
});
