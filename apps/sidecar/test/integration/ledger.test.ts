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
  it('TC-M3-004 writes a zero-cost ledger row for a free-tier model', async () => {
    sidecar = await startSidecar({ ITSTUDIO_E2E_LLM_TEXT: 'Free model reply.' });
    const workspace = resolve(sidecar.dataDir, 'free-tier-workspace');
    await mkdir(workspace);
    const projectId = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'Free tier', workspaceRoot: workspace })).result,
    ).id;
    const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
    const modelKey = modelKeySchema.parse(settings.router.ladder[0]?.modelKey);
    const provider = providerIdSchema.parse(modelKey.split('/')[0]);
    await sidecar.call('secrets.set', { provider, apiKey: 'integration-only-scripted-key' });
    const current = priceTableSchema.parse((await sidecar.call('pricing.get')).result);
    const original = current.entries.find((entry) => entry.modelKey === modelKey);
    if (original === undefined) throw new Error('Selected model does not have a price entry');
    await sidecar.call('pricing.override', {
      entry: {
        ...original,
        inputPerMTokMicroUsd: microUsdSchema.parse(0),
        outputPerMTokMicroUsd: microUsdSchema.parse(0),
        cachedInputPerMTokMicroUsd: microUsdSchema.parse(0),
        freeTier: true,
      },
    });
    const conversationId = conversationSchema.parse(
      (await sidecar.call('chat.createConversation', { projectId })).result,
    ).id;
    let entries = 0;
    sidecar.notifications.on('notification', (value: unknown) => {
      if (typeof value === 'object' && value !== null && 'method' in value && value.method === 'ledger.entry')
        entries += 1;
    });
    await sidecar.call('chat.send', { conversationId, text: 'record free usage' });
    await waitFor(() => entries === 1);
    const page = z
      .object({ items: z.array(ledgerEntrySchema) })
      .parse((await sidecar.call('ledger.query', { projectId, limit: 10 })).result);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.costMicroUsd).toBe(0);
  }, 30_000);

  it('TC-M3-051 paginates 250 scripted chat ledger rows without gaps or duplicates', async () => {
    const total = 250;
    sidecar = await startSidecar({ ITSTUDIO_E2E_LLM_TEXT: 'Paginated ledger reply.' });
    const workspace = resolve(sidecar.dataDir, 'ledger-pagination-workspace');
    await mkdir(workspace);
    const projectId = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'Ledger pagination', workspaceRoot: workspace })).result,
    ).id;
    const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
    const modelKey = modelKeySchema.parse(settings.router.ladder[0]?.modelKey);
    const provider = providerIdSchema.parse(modelKey.split('/')[0]);
    await sidecar.call('secrets.set', { provider, apiKey: 'integration-only-scripted-key' });
    let ledgerNotifications = 0;
    sidecar.notifications.on('notification', (value: unknown) => {
      if (typeof value === 'object' && value !== null && 'method' in value && value.method === 'ledger.entry')
        ledgerNotifications += 1;
    });
    for (let index = 0; index < total; index += 1) {
      const conversationId = conversationSchema.parse(
        (await sidecar.call('chat.createConversation', { projectId })).result,
      ).id;
      await sidecar.call('chat.send', { conversationId, text: `page ledger row ${String(index)}` });
    }
    await waitFor(() => ledgerNotifications === total, 60_000);
    const entries: z.infer<typeof ledgerEntrySchema>[] = [];
    const pageSizes: number[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = z
        .object({ items: z.array(ledgerEntrySchema), nextCursor: z.string().nullable() })
        .parse(
          (await sidecar.call('ledger.query', { projectId, limit: 100, ...(cursor === undefined ? {} : { cursor }) }))
            .result,
        );
      entries.push(...page.items);
      pageSizes.push(page.items.length);
      cursor = page.nextCursor ?? undefined;
      if (cursor === undefined) break;
    }
    expect(pageSizes).toEqual([100, 100, 50]);
    expect(entries).toHaveLength(total);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(total);
  }, 90_000);

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
