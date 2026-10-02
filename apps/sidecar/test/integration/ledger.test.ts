import { afterEach, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { modelKeySchema, providerIdSchema } from '../../src/validation/common.js';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { projectSchema } from '../../src/validation/projects.js';
import { conversationSchema } from '../../src/validation/chat.js';
import { ledgerEntrySchema, priceTableSchema } from '../../src/validation/cost.js';
import { microUsdSchema } from '../../src/validation/brand.js';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';
import { z } from 'zod';

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

  it('TC-M3-010 applies an RPC price override to the next chat and preserves the earlier ledger row', async () => {
    sidecar = await startSidecar({ ITSTUDIO_E2E_LLM_TEXT: 'Pricing integration reply.' });
    const workspace = resolve(sidecar.dataDir, 'pricing-workspace');
    await mkdir(workspace);
    const projectId = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'Pricing test', workspaceRoot: workspace })).result,
    ).id;
    const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
    const modelKey = modelKeySchema.parse(settings.router.ladder[0]?.modelKey);
    const provider = providerIdSchema.parse(modelKey.split('/')[0]);
    await sidecar.call('secrets.set', { provider, apiKey: 'integration-only-scripted-key' });
    const conversationId = conversationSchema.parse(
      (await sidecar.call('chat.createConversation', { projectId })).result,
    ).id;
    let ledgerNotifications = 0;
    sidecar.notifications.on('notification', (value: unknown) => {
      if (typeof value === 'object' && value !== null && 'method' in value && value.method === 'ledger.entry')
        ledgerNotifications += 1;
    });

    const firstChat = await sidecar.call('chat.send', { conversationId, text: 'first price' });
    const requestSchema = z.object({ requestId: z.uuid() });
    const firstRequestId = requestSchema.parse(firstChat.result).requestId;
    await waitFor(() => ledgerNotifications === 1);
    const firstPage = z
      .object({ items: z.array(ledgerEntrySchema) })
      .parse((await sidecar.call('ledger.query', { projectId, limit: 10 })).result);
    const firstEntry = firstPage.items.find((entry) => entry.llmRequestId === firstRequestId);
    if (firstEntry === undefined) throw new Error('First chat ledger entry was not persisted');

    const current = priceTableSchema.parse((await sidecar.call('pricing.get')).result);
    const originalPrice = current.entries.find((entry) => entry.modelKey === modelKey);
    if (originalPrice === undefined) throw new Error('Seed price table is missing the selected model');
    const overrideResponse = await sidecar.call('pricing.override', {
      entry: {
        ...originalPrice,
        inputPerMTokMicroUsd: microUsdSchema.parse(originalPrice.inputPerMTokMicroUsd + 1_000_000),
      },
    });
    const overridden = priceTableSchema.parse(overrideResponse.result);
    expect(overridden.version).not.toBe(firstEntry.priceTableVersion);

    const secondChat = await sidecar.call('chat.send', { conversationId, text: 'second price' });
    const secondRequestId = requestSchema.parse(secondChat.result).requestId;
    await waitFor(() => ledgerNotifications === 2);
    const finalPage = z
      .object({ items: z.array(ledgerEntrySchema) })
      .parse((await sidecar.call('ledger.query', { projectId, limit: 10 })).result);
    const earlierAfterOverride = finalPage.items.find((entry) => entry.llmRequestId === firstRequestId);
    const secondEntry = finalPage.items.find((entry) => entry.llmRequestId === secondRequestId);
    expect(earlierAfterOverride).toEqual(firstEntry);
    expect(secondEntry?.priceTableVersion).toBe(overridden.version);
    expect(secondEntry?.costMicroUsd).toBeGreaterThan(firstEntry.costMicroUsd);
  }, 30_000);
});
