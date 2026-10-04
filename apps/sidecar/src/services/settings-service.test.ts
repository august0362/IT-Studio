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
