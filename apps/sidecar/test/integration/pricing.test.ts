import { afterEach, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ModelDescriptor, PriceEntry, ProjectId } from '@itstudio/schemas';
import { projectSchema } from '../../src/validation/projects.js';
import { conversationSchema } from '../../src/validation/chat.js';
import { ledgerEntrySchema, priceTableSchema, priceUpdateRunSchema } from '../../src/validation/cost.js';
import { microUsdSchema } from '../../src/validation/brand.js';
import { loadSeeds } from '../../src/config/load-seeds.js';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';
import { z } from 'zod';

let sidecar: SidecarHarness | undefined;

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

function requireSidecar(): SidecarHarness {
  if (sidecar === undefined) throw new Error('Pricing integration sidecar has not started');
  return sidecar;
}

async function startPricingProject(entryChange: number): Promise<{
  readonly projectId: ProjectId;
  readonly model: ModelDescriptor;
  readonly original: PriceEntry;
  readonly chatRow: ReturnType<typeof ledgerEntrySchema.parse>;
}> {
  const seeds = loadSeeds('config');
  if (!seeds.ok) throw new Error(seeds.error.message);
  const modelKey = seeds.value.defaultPricingExtractionModel;
  const model = seeds.value.models.find((item) => item.key === modelKey);
  const original = seeds.value.pricing.entries.find((item) => item.modelKey === modelKey);
  if (model === undefined || original === undefined)
    throw new Error('Extraction model is missing its descriptor or price');
  const updated: PriceEntry = {
    ...original,
    inputPerMTokMicroUsd: microUsdSchema.parse(original.inputPerMTokMicroUsd + entryChange),
  };
  const extractionResponse = JSON.stringify({ entries: [updated] });
  const responses = Object.fromEntries(
    seeds.value.models.map((item) => [item.providerModelId, 'Integration chat reply.']),
  );
  responses[model.providerModelId] = extractionResponse;
  sidecar = await startSidecar({ ITSTUDIO_E2E_LLM_TEXT: JSON.stringify(responses) });
  const workspace = resolve(sidecar.dataDir, 'pricing-workspace');
  await mkdir(workspace);
  const projectId = projectSchema.parse(
    (await sidecar.call('project.create', { name: 'Pricing integration', workspaceRoot: workspace })).result,
  ).id;
  await sidecar.call('project.setActive', { projectId });
  await sidecar.call('secrets.set', { provider: model.provider, apiKey: 'integration-only-scripted-key' });
  let ledgerNotifications = 0;
  sidecar.notifications.on('notification', (value: unknown) => {
    if (typeof value === 'object' && value !== null && 'method' in value && value.method === 'ledger.entry')
      ledgerNotifications += 1;
  });
  const conversationId = conversationSchema.parse(
    (await sidecar.call('chat.createConversation', { projectId })).result,
  ).id;
  const chatResult = await sidecar.call('chat.send', {
    conversationId,
    text: 'Record a cost before updating prices.',
    modelOverride: modelKey,
  });
  expect(chatResult.error).toBeUndefined();
  await waitFor(() => ledgerNotifications > 0);
  const ledgerPage = z
    .object({ items: z.array(ledgerEntrySchema) })
    .parse((await sidecar.call('ledger.query', { projectId, limit: 20 })).result);
  const chatRow = ledgerPage.items.find((item) => item.purpose === 'chat');
  if (chatRow === undefined) throw new Error('The pre-update chat ledger row was not written');
  const current = priceTableSchema.parse((await sidecar.call('pricing.get')).result);
  expect(current.entries.find((item) => item.modelKey === modelKey)).toEqual(original);
  return { projectId, model, original, chatRow };
}

describe('pricing updater integration', () => {
  it('TC-M3-020 applies +10% and keeps an older ledger row frozen', async () => {
    const seeds = loadSeeds('config');
    if (!seeds.ok) throw new Error(seeds.error.message);
    const original = seeds.value.pricing.entries.find(
      (entry) => entry.modelKey === seeds.value.defaultPricingExtractionModel,
    );
    if (original === undefined) throw new Error('Extraction model is missing its price');
    const amount = original.inputPerMTokMicroUsd / 10;
    const setup = await startPricingProject(amount);
    const app = requireSidecar();
    const chatRow = setup.chatRow;
    const notifications: string[] = [];
    app.notifications.on('notification', (value: unknown) => {
      if (typeof value === 'object' && value !== null && 'method' in value && typeof value.method === 'string')
        notifications.push(value.method);
    });
    const run = priceUpdateRunSchema.parse((await app.call('pricing.refresh')).result);
    expect(run.status).toBe('applied');
    expect(run.deltas.some((delta) => delta.modelKey === setup.model.key && delta.percent === 10)).toBe(true);
    await waitFor(() => notifications.includes('pricing.updated'));
    const current = priceTableSchema.parse((await app.call('pricing.get')).result);
    expect(current.version).toBe(run.newVersion);
    expect(current.entries.find((entry) => entry.modelKey === setup.model.key)?.inputPerMTokMicroUsd).toBe(
      setup.original.inputPerMTokMicroUsd + amount,
    );
    const after = z
      .object({ items: z.array(ledgerEntrySchema) })
      .parse((await app.call('ledger.query', { projectId: setup.projectId, limit: 20 })).result);
    expect(after.items.find((entry) => entry.id === chatRow.id)?.costMicroUsd).toBe(chatRow.costMicroUsd);
  }, 30_000);

  it('TC-M3-021 rejects +80% and leaves the price table unchanged', async () => {
    const seeds = loadSeeds('config');
    if (!seeds.ok) throw new Error(seeds.error.message);
    const entry = seeds.value.pricing.entries.find(
      (item) => item.modelKey === seeds.value.defaultPricingExtractionModel,
    );
    if (entry === undefined) throw new Error('Extraction model is missing its price');
    const setup = await startPricingProject(entry.inputPerMTokMicroUsd * 0.8);
    const app = requireSidecar();
    const before = priceTableSchema.parse((await app.call('pricing.get')).result);
    const run = priceUpdateRunSchema.parse((await app.call('pricing.refresh')).result);
    expect(run.status).toBe('rejected_validation');
    expect(run.deltas.some((delta) => delta.modelKey === setup.model.key && delta.percent === 80)).toBe(true);
    expect(priceTableSchema.parse((await app.call('pricing.get')).result)).toEqual(before);
  }, 30_000);
});
