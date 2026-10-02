import { afterEach, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { projectSchema } from '../../src/validation/projects.js';
import { conversationSchema } from '../../src/validation/chat.js';
import { isoDateTimeSchema, providerIdSchema } from '../../src/validation/common.js';
import { ledgerEntrySchema } from '../../src/validation/cost.js';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';
import { z } from 'zod';

let sidecar: SidecarHarness | undefined;

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

describe('P&L integration', () => {
  it('TC-M3-040 combines scripted ledger costs and USD/VND revenue across projects', async () => {
    sidecar = await startSidecar({ ITSTUDIO_E2E_LLM_TEXT: 'P&L integration reply.' });
    const workspaceA = resolve(sidecar.dataDir, 'pnl-project-a');
    const workspaceB = resolve(sidecar.dataDir, 'pnl-project-b');
    await mkdir(workspaceA);
    await mkdir(workspaceB);
    const projectA = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'P&L A', workspaceRoot: workspaceA })).result,
    );
    const projectB = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'P&L B', workspaceRoot: workspaceB })).result,
    );
    const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
    const firstKey = settings.router.ladder[0]?.modelKey;
    if (firstKey === undefined) throw new Error('The router has no configured model');
    const provider = providerIdSchema.parse(firstKey.split('/')[0]);
    await sidecar.call('secrets.set', { provider, apiKey: 'integration-only-scripted-key' });
    let completed = 0;
    sidecar.notifications.on('notification', (value: unknown) => {
      if (typeof value === 'object' && value !== null && 'method' in value && value.method === 'ledger.entry')
        completed += 1;
    });
    for (const project of [projectA, projectB]) {
      const conversation = await sidecar.call('chat.createConversation', { projectId: project.id });
      const conversationResult = conversationSchema.parse(conversation.result);
      await sidecar.call('chat.send', { conversationId: conversationResult.id, text: 'record P&L cost' });
    }
    await waitFor(() => completed === 2);
    // Pin the FX rate so the VND oracle is exact (the seed rate is 26 300); also exercises the override path.
    expect((await sidecar.call('fx.override', { usdToVnd: 25_000 })).error).toBeUndefined();
    const revenueA = await sidecar.call('revenue.add', {
      projectId: projectA.id,
      amount: 25_000,
      currency: 'VND',
      description: 'VND invoice',
    });
    const revenueB = await sidecar.call('revenue.add', {
      projectId: projectB.id,
      amount: 2,
      currency: 'USD',
      description: 'USD invoice',
    });
    expect(revenueA.error).toBeUndefined();
    expect(revenueB.error).toBeUndefined();
    const from = isoDateTimeSchema.parse('2020-01-01T00:00:00.000Z');
    const to = isoDateTimeSchema.parse('2030-01-01T00:00:00.000Z');
    const revenueRows = await sidecar.call('revenue.listRows', { projectId: projectA.id, from, to });
    expect(revenueRows.error).toBeUndefined();
    expect((revenueRows.result as { readonly amount: { readonly microUsd: number } }[])[0]?.amount.microUsd).toBe(
      (revenueA.result as { readonly amountMicroUsd: number }).amountMicroUsd,
    );
    const expectedCosts: number[] = [];
    for (const project of [projectA, projectB]) {
      const ledgerPage = await sidecar.call('ledger.query', { projectId: project.id, limit: 10 });
      const displayRows = await sidecar.call('ledger.queryRows', { projectId: project.id, limit: 10 });
      expect(displayRows.error).toBeUndefined();
      const displayed = displayRows.result as {
        readonly items: readonly {
          readonly entry: { readonly costMicroUsd: number };
          readonly cost: { readonly microUsd: number };
        }[];
      };
      expect(displayed.items.map((row) => row.cost.microUsd)).toEqual(
        displayed.items.map((row) => row.entry.costMicroUsd),
      );
      expectedCosts.push(
        z
          .object({ items: z.array(ledgerEntrySchema) })
          .parse(ledgerPage.result)
          .items.reduce((sum, row) => sum + row.costMicroUsd, 0),
      );
    }
    const first = await sidecar.call('pnl.get', { projectId: projectA.id, from, to });
    const all = await sidecar.call('pnl.getAll', { from, to });
    expect(first.error).toBeUndefined();
    expect(all.error).toBeUndefined();
    const firstResult = first.result as {
      readonly revenue: { readonly microUsd: number };
      readonly cost: { readonly microUsd: number };
    };
    const allResult = all.result as {
      readonly revenue: { readonly microUsd: number };
      readonly cost: { readonly microUsd: number };
      readonly projects: readonly {
        readonly revenue: { readonly microUsd: number };
        readonly cost: { readonly microUsd: number };
      }[];
    };
    expect(firstResult.revenue.microUsd).toBe(1_000_000);
    expect(firstResult.cost.microUsd).toBe(expectedCosts[0]);
    expect(allResult.revenue.microUsd).toBe(3_000_000);
    expect(allResult.cost.microUsd).toBe(expectedCosts.reduce((sum, cost) => sum + cost, 0));
    expect(allResult.cost.microUsd).toBe(allResult.projects.reduce((sum, project) => sum + project.cost.microUsd, 0));
    expect(allResult.revenue.microUsd).toBe(
      allResult.projects.reduce((sum, project) => sum + project.revenue.microUsd, 0),
    );
    expect(
      (await sidecar.call('revenue.add', { projectId: projectA.id, amount: 0, currency: 'USD', description: '' })).error
        ?.code,
    ).toBe(-32602);
    expect((await sidecar.call('pnl.getAll', { from: to, to: from })).error?.code).toBe(-32000);
  }, 30_000);
});
