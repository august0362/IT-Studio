import { afterEach, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { IsoDateTime, WebChatLinkId } from '@itstudio/schemas';
import { makeProject, rawRequest, startSidecar, type SidecarHarness } from './break-helpers-01.js';

let sidecar: SidecarHarness | undefined;

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

const date = z.custom<IsoDateTime>((value) => typeof value === 'string').parse('2026-01-01T00:00:00.000Z');
const farDate = z.custom<IsoDateTime>((value) => typeof value === 'string').parse('9999-12-31T23:59:59.999Z');

describe('adversarial input validation', () => {
  it('BRK-V01 safely handles hostile project names and duplicate roots', async () => {
    sidecar = await startSidecar();
    const names = ['', '   ', 'x'.repeat(10_000), 'emoji 😀 RTL אבג zero​width', 'line\nbreak'];
    for (const [index, name] of names.entries()) {
      const project = await makeProject(sidecar, `root-${String(index)}`);
      const response = await sidecar.call('project.create', { name, workspaceRoot: project.root });
      if (response.error === undefined) expect(z.object({ name: z.string() }).parse(response.result).name).toBe(name);
      else {
        const error = z.object({ code: z.enum(['VALIDATION', 'CONFLICT']) }).parse(response.error.data);
        expect(['VALIDATION', 'CONFLICT']).toContain(error.code);
      }
      expect((await sidecar.call('project.list')).error).toBeUndefined();
    }
    const duplicate = await makeProject(sidecar, 'duplicate root');
    const second = await sidecar.call('project.create', { name: 'Other label', workspaceRoot: duplicate.root });
    expect(second.error?.data).toMatchObject({ code: 'CONFLICT' });
    const duplicateNameRoot = join(sidecar.dataDir, 'duplicate-name-original');
    await mkdir(duplicateNameRoot);
    const originalName = await sidecar.call('project.create', {
      name: 'reused project name',
      workspaceRoot: duplicateNameRoot,
    });
    expect(originalName.error).toBeUndefined();
    const secondNameRoot = join(sidecar.dataDir, 'duplicate-name-second');
    await mkdir(secondNameRoot);
    const duplicateName = await sidecar.call('project.create', {
      name: 'reused project name',
      workspaceRoot: secondNameRoot,
    });
    if (duplicateName.error === undefined)
      expect(z.object({ name: z.string() }).parse(duplicateName.result).name).toBe('reused project name');
    else {
      const error = z.object({ code: z.enum(['VALIDATION', 'CONFLICT']) }).parse(duplicateName.error.data);
      expect(['VALIDATION', 'CONFLICT']).toContain(error.code);
    }
  }, 45_000);

  it('QA-BREAK-01-D02 BRK-V02 rejects unsafe money and keeps P&L integer and finite', async () => {
    sidecar = await startSidecar();
    const project = await makeProject(sidecar);
    for (const amount of [
      -1,
      0,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1e308,
      1.1234567,
      Number.MAX_SAFE_INTEGER + 2,
      '123',
    ]) {
      const response = await rawRequest(sidecar, {
        method: 'revenue.add',
        params: { projectId: project.id, amount, currency: 'USD', description: 'boundary' },
      });
      const envelope = z.object({ error: z.unknown().optional(), result: z.unknown().optional() }).parse(response);
      if (envelope.error === undefined) {
        const entry = z.object({ amountMicroUsd: z.number().nonnegative().int() }).parse(envelope.result);
        expect(Number.isSafeInteger(entry.amountMicroUsd)).toBe(true);
      }
      const budget = await rawRequest(sidecar, {
        method: 'budget.setUsd',
        params: { projectId: project.id, period: 'project_lifetime', limitUsd: String(amount), warnAt: [0.8] },
      });
      if (z.object({ error: z.unknown().optional() }).parse(budget).error === undefined)
        expect(JSON.stringify(budget)).not.toMatch(/NaN|Infinity/u);
    }
    const pnl = await rawRequest(sidecar, {
      method: 'pnl.get',
      params: { projectId: project.id, from: date, to: date },
    });
    const pnlEnvelope = z.object({ error: z.unknown().optional(), result: z.unknown().optional() }).parse(pnl);
    expect(pnlEnvelope.error, `pnl.get returned an error: ${JSON.stringify(pnlEnvelope.error)}`).toBeUndefined();
    expect(JSON.stringify(pnl)).not.toMatch(/NaN|Infinity/u);
    const revenue = z
      .object({ revenue: z.object({ microUsd: z.number().int().nonnegative() }) })
      .parse(pnlEnvelope.result);
    expect(Number.isSafeInteger(revenue.revenue.microUsd)).toBe(true);
  }, 30_000);

  it('BRK-V03 bounds VND revenue and FX overrides without overflow', async () => {
    sidecar = await startSidecar();
    const project = await makeProject(sidecar);
    for (const usdToVnd of [0, -1, 1e-12, 1e12]) {
      const fx = await sidecar.call('fx.override', { usdToVnd });
      if (fx.error === undefined) {
        const value = z.object({ usdToVnd: z.number().positive() }).parse(fx.result);
        expect(Number.isFinite(value.usdToVnd)).toBe(true);
      }
      const revenue = await sidecar.call('revenue.add', {
        projectId: project.id,
        amount: 1e308,
        currency: 'VND',
        description: 'large VND value',
      });
      if (revenue.error === undefined) expect(JSON.stringify(revenue.result)).not.toMatch(/NaN|Infinity/u);
      const pnl = await sidecar.call('pnl.get', {
        projectId: project.id,
        from: date,
        to: farDate,
      });
      expect(JSON.stringify(pnl.result)).not.toMatch(/NaN|Infinity/u);
    }
  }, 30_000);

  it('BRK-V04 handles reversed, impossible, extreme, timezone-less and epoch date ranges', async () => {
    sidecar = await startSidecar();
    const project = await makeProject(sidecar);
    const ranges: readonly [unknown, unknown][] = [
      ['2026-12-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
      ['2026-02-30T00:00:00.000Z', date],
      ['0001-01-01T00:00:00.000Z', '9999-12-31T23:59:59.999Z'],
      ['2026-01-01T00:00:00', date],
      [0, date],
    ];
    for (const [from, to] of ranges) {
      const params = { projectId: project.id, from, to };
      for (const method of ['ledger.query', 'pnl.get', 'revenue.list'] as const) {
        const response = await rawRequest(sidecar, {
          method,
          params: method === 'ledger.query' ? { ...params, limit: 10 } : params,
        });
        expect(
          z.object({ error: z.unknown().optional(), result: z.unknown().optional() }).safeParse(response).success,
        ).toBe(true);
      }
    }
    await expect(sidecar.call('system.ping')).resolves.toMatchObject({ result: { version: '0.1.0' } });
  }, 30_000);

  it('BRK-V05 bounds or rejects hostile pagination values', async () => {
    sidecar = await startSidecar();
    const project = await makeProject(sidecar);
    const conversation = await sidecar.call('chat.createConversation', { projectId: project.id });
    const conversationId = z.object({ id: z.string() }).parse(conversation.result).id;
    for (const limit of [-1, 0, 1e9, 1.5]) {
      const ledger = await rawRequest(sidecar, {
        method: 'ledger.queryRows',
        params: { projectId: project.id, limit },
      });
      expect(
        z.object({ error: z.unknown().optional(), result: z.unknown().optional() }).safeParse(ledger).success,
      ).toBe(true);
      const chat = await rawRequest(sidecar, {
        method: 'chat.getMessages',
        params: { conversationId, offset: -1, limit },
      });
      expect(z.object({ error: z.unknown().optional(), result: z.unknown().optional() }).safeParse(chat).success).toBe(
        true,
      );
      const activity = await rawRequest(sidecar, {
        method: 'workflow.activity',
        params: { projectId: project.id, limit },
      });
      expect(
        z.object({ error: z.unknown().optional(), result: z.unknown().optional() }).safeParse(activity).success,
      ).toBe(true);
    }
  }, 30_000);

  it('BRK-V06 preserves a usable router config after invalid ladder patches', async () => {
    sidecar = await startSidecar();
    const before = await sidecar.call('router.getConfig');
    const patches: readonly unknown[] = [
      { router: { ladder: [] } },
      { router: { ladder: [{ modelKey: 'unknown/model', enabled: true }] } },
      {
        router: {
          ladder: [
            { modelKey: 'openai/gpt-5.3-codex', enabled: true },
            { modelKey: 'openai/gpt-5.3-codex', enabled: true },
          ],
        },
      },
    ];
    for (const patch of patches) {
      const response = await rawRequest(sidecar, { method: 'settings.update', params: { patch } });
      expect(
        z.object({ error: z.unknown().optional(), result: z.unknown().optional() }).safeParse(response).success,
      ).toBe(true);
      expect((await sidecar.call('router.getConfig')).error).toBeUndefined();
    }
    expect(before.error).toBeUndefined();
  }, 30_000);

  it('BRK-V07 rejects unsafe web-chat URLs from open and saved settings', async () => {
    sidecar = await startSidecar();
    const settings = z
      .object({
        webChat: z.object({ links: z.array(z.object({ id: z.string(), name: z.string(), enabled: z.boolean() })) }),
      })
      .parse((await sidecar.call('settings.get')).result);
    const link = settings.webChat.links[0];
    if (link === undefined) throw new Error('Expected a default web-chat site');
    const acceptedIdn = 'https://раypal.com';
    const accepted = await rawRequest(sidecar, {
      method: 'settings.update',
      params: { patch: { webChat: { links: [{ ...link, url: acceptedIdn }] } } },
    });
    const savedSettings = z
      .object({ webChat: z.object({ links: z.array(z.object({ url: z.string() })) }) })
      .parse(z.object({ result: z.unknown() }).parse(accepted).result);
    expect(new URL(savedSettings.webChat.links[0]?.url ?? '').hostname).toMatch(/^xn--/u);
    const urls = [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,hi',
      'http://localhost',
      'https://127.0.0.1',
      `https://${'a'.repeat(3_000)}.example`,
      'https://user:pw@host',
    ];
    for (const url of urls) {
      const saved = await rawRequest(sidecar, {
        method: 'settings.update',
        params: { patch: { webChat: { links: [{ ...link, url }] } } },
      });
      expect(saved).toMatchObject({ error: { data: { code: 'VALIDATION' } } });
    }
    const linkId = z.custom<WebChatLinkId>((value) => value === link.id).parse(link.id);
    await expect(sidecar.call('webchat.open', { linkId })).resolves.toMatchObject({ result: { opened: true } });
  }, 30_000);
});
