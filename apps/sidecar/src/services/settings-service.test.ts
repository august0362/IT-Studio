import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSeeds } from '../config/load-seeds.js';
import { buildDefaultSettings } from '../domain/default-settings.js';
import { createFakeClock } from '../infra/clock.js';
import { openDatabase } from '../infra/sqlite/database.js';
import { SettingsRepository } from '../infra/sqlite/settings-repository.js';
import { createLogger } from '../infra/logger.js';
import { themeIdSchema } from '../validation/common.js';
import { SettingsService } from './settings-service.js';

const directories: string[] = [];

function createService() {
  const dir = mkdtempSync(join(tmpdir(), 'itstudio-settings-'));
  directories.push(dir);
  const opened = openDatabase(dir);
  const loaded = loadSeeds('config');
  if (!loaded.ok) throw new Error(loaded.error.message);
  const service = new SettingsService({
    repository: new SettingsRepository(opened.db),
    defaults: buildDefaultSettings(loaded.value),
    dataDir: dir,
    themeIds: new Set(loaded.value.themes.themes.map((theme) => theme.id)),
    clock: createFakeClock(new Date('2026-01-01T00:00:00.000Z')),
    logger: createLogger({ streams: [] }),
  });
  return { opened, service, loaded };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('SettingsService', () => {
  it('PROV-01 upgrades legacy settings and persists Qwen endpoints without losing other settings', async () => {
    const { opened, service, loaded } = createService();
    try {
      const legacy = Object.fromEntries(
        Object.entries(buildDefaultSettings(loaded.value)).filter(([key]) => key !== 'providers'),
      );
      const repository = new SettingsRepository(opened.db);
      await repository.save(JSON.stringify({ ...legacy, budget: { hardStop: true } }), '2026-01-01T00:00:00.000Z');
      expect(await service.get()).toMatchObject({
        ok: true,
        value: {
          providers: { qwen: { baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' } },
          budget: { hardStop: true },
        },
      });
      const baseUrl = 'https://workspace.example/compatible-mode/v1';
      expect(await service.update({ providers: { qwen: { baseUrl } } })).toMatchObject({ ok: true });
      expect(await service.update({ providers: {} })).toMatchObject({
        ok: true,
        value: { providers: { qwen: { baseUrl } } },
      });
      expect(await service.get()).toMatchObject({
        ok: true,
        value: { providers: { qwen: { baseUrl } }, budget: { hardStop: true } },
      });
      for (const invalid of ['http://workspace.example/v1', 'invalid', 'https://' + 'a'.repeat(301)]) {
        expect(await service.update({ providers: { qwen: { baseUrl: invalid } } })).toMatchObject({
          ok: false,
          error: { code: 'VALIDATION' },
        });
      }
      expect(await service.get()).toMatchObject({ ok: true, value: { providers: { qwen: { baseUrl } } } });
      const boundary = 'https://example.com/' + 'a'.repeat(280);
      expect(boundary).toHaveLength(300);
      expect(await service.update({ providers: { qwen: { baseUrl: boundary } } })).toMatchObject({ ok: true });
      expect(await service.update({ providers: { qwen: { baseUrl: boundary + 'a' } } })).toMatchObject({ ok: false });
    } finally {
      opened.client.close();
    }
  });
  it('QA-BREAK-02-D08 merges simultaneous patches against the latest persisted settings', async () => {
    const { opened, service } = createService();
    try {
      const results = await Promise.all([
        service.update({ ui: { locale: 'vi' } }),
        service.update({ budget: { hardStop: true } }),
        service.update({ ui: { mode: 'dark' } }),
      ]);
      expect(results.every((result) => result.ok)).toBe(true);
      expect(await service.get()).toMatchObject({
        ok: true,
        value: { ui: { locale: 'vi', mode: 'dark' }, budget: { hardStop: true } },
      });
      expect(await service.update({ ui: { themeId: themeIdSchema.parse('unknown') } })).toMatchObject({ ok: false });
      expect(await service.update({ ui: { locale: 'en' } })).toMatchObject({ ok: true });
    } finally {
      opened.client.close();
    }
  });
  it('PSTUDIO-01 defaults autoClarify to false, upgrades older settings, and saves changes', async () => {
    const { opened, service, loaded } = createService();
    try {
      const defaults = buildDefaultSettings(loaded.value);
      expect(defaults.pipeline.autoClarify).toBe(false);
      const legacy = {
        ...defaults,
        pipeline: Object.fromEntries(Object.entries(defaults.pipeline).filter(([key]) => key !== 'autoClarify')),
        budget: { hardStop: true },
      };
      const repository = new SettingsRepository(opened.db);
      await repository.save(JSON.stringify(legacy), '2026-01-01T00:00:00.000Z');
      expect(await service.get()).toMatchObject({
        ok: true,
        value: {
          pipeline: { autoClarify: false, roleAssignment: defaults.pipeline.roleAssignment },
          budget: { hardStop: true },
        },
      });
      expect((await repository.load())?.json).toContain('"autoClarify":false');
      expect(await service.update({ pipeline: { autoClarify: true } })).toMatchObject({
        ok: true,
        value: { pipeline: { autoClarify: true } },
      });
      expect(await service.get()).toMatchObject({ ok: true, value: { pipeline: { autoClarify: true } } });
    } finally {
      opened.client.close();
    }
  });
  it('persists web-chat layout and reconciles panes when saved sites are disabled', async () => {
    const { opened, service, loaded } = createService();
    try {
      const links = buildDefaultSettings(loaded.value).webChat.links;
      const first = links[0];
      const second = links[1];
      if (first === undefined || second === undefined) throw new Error('Missing default web-chat links');
      const saved = await service.update({ webChat: { layout: { panes: [first.id, second.id], sizes: [0.4, 0.6] } } });
      expect(saved).toMatchObject({
        ok: true,
        value: { webChat: { layout: { panes: [first.id, second.id], sizes: [0.4, 0.6] } } },
      });
      expect((await new SettingsRepository(opened.db).load())?.json).toContain('"sizes":[0.4,0.6]');
      const reduced = await service.update({
        webChat: { links: links.map((link) => (link.id === first.id ? { ...link, enabled: false } : link)) },
      });
      expect(reduced).toMatchObject({ ok: true, value: { webChat: { layout: { panes: [second.id], sizes: [1] } } } });
      const cleared = await service.update({ webChat: { links: [] } });
      expect(cleared.ok && cleared.value.webChat.layout).toBeUndefined();
    } finally {
      opened.client.close();
    }
  });

  it('rejects an explicit pane layout selecting a disabled saved site', async () => {
    const { opened, service, loaded } = createService();
    try {
      const links = buildDefaultSettings(loaded.value).webChat.links;
      const first = links[0];
      if (first === undefined) throw new Error('Missing default web-chat link');
      const result = await service.update({
        webChat: {
          links: links.map((link) => ({ ...link, enabled: false })),
          layout: { panes: [first.id], sizes: [1] },
        },
      });
      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    } finally {
      opened.client.close();
    }
  });

  it('creates defaults and deep-merges nested patches', async () => {
    const { opened, service } = createService();
    const initial = await service.get();
    expect(initial.ok).toBe(true);
    const updated = await service.update({ router: { autoFallback: false }, ui: { locale: 'vi' } });
    expect(updated.ok && updated.value.router.autoFallback).toBe(false);
    expect(updated.ok && updated.value.router.ladder.length).toBeGreaterThan(0);
    expect(updated.ok && updated.value.ui.locale).toBe('vi');
    opened.client.close();
  });

  it('rejects an unknown theme id', async () => {
    const { opened, service } = createService();
    const result = await service.update({ ui: { themeId: themeIdSchema.parse('made-up') } });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    opened.client.close();
  });

  it('backs up and resets corrupt stored JSON', async () => {
    const { opened, service } = createService();
    await new SettingsRepository(opened.db).save('{broken', '2026-01-01T00:00:00.000Z');
    const recovered = await service.get();
    expect(recovered.ok).toBe(true);
    expect(readdirSync(directories.at(-1) ?? '').some((name) => name.startsWith('settings_backup_'))).toBe(true);
    const saved = await new SettingsRepository(opened.db).load();
    expect(saved?.json).toContain('activeProjectId');
    opened.client.close();
  });

  it('upgrades v1 settings without resetting stored router, budget, or UI values', async () => {
    const { opened, service, loaded } = createService();
    const defaults = buildDefaultSettings(loaded.value);
    const legacy = {
      ...defaults,
      router: { ...defaults.router, autoFallback: false },
      budget: { hardStop: true },
      ui: { ...defaults.ui, locale: 'vi' as const },
    };
    const v1Settings = Object.fromEntries(Object.entries(legacy).filter(([key]) => key !== 'webChat'));
    await new SettingsRepository(opened.db).save(JSON.stringify(v1Settings), '2026-01-01T00:00:00.000Z');
    const result = await service.get();
    expect(result).toMatchObject({
      ok: true,
      value: {
        router: { autoFallback: false },
        budget: { hardStop: true },
        ui: { locale: 'vi' },
        webChat: defaults.webChat,
      },
    });
    opened.client.close();
  });
});
