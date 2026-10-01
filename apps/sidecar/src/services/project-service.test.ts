import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSeeds } from '../config/load-seeds.js';
import { buildDefaultSettings } from '../domain/default-settings.js';
import { createFakeClock } from '../infra/clock.js';
import { createFakeIdGenerator } from '../infra/id.js';
import { openDatabase } from '../infra/sqlite/database.js';
import { ProjectRepository } from '../infra/sqlite/project-repository.js';
import { SettingsRepository } from '../infra/sqlite/settings-repository.js';
import { createLogger } from '../infra/logger.js';
import { SettingsService } from './settings-service.js';
import { ProjectService } from './project-service.js';

const directories: string[] = [];

function createService() {
  const dir = mkdtempSync(join(tmpdir(), 'itstudio-project-'));
  directories.push(dir);
  const opened = openDatabase(dir);
  const loaded = loadSeeds('config');
  if (!loaded.ok) throw new Error(loaded.error.message);
  const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'));
  const settings = new SettingsService({
    repository: new SettingsRepository(opened.db),
    defaults: buildDefaultSettings(loaded.value),
    dataDir: dir,
    themeIds: new Set(loaded.value.themes.themes.map((theme) => theme.id)),
    clock,
    logger: createLogger({ streams: [] }),
  });
  return {
    opened,
    service: new ProjectService({
      repository: new ProjectRepository(opened.db),
      settings,
      ids: createFakeIdGenerator(['a1111111-1111-4111-8111-111111111111']),
      clock,
    }),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('ProjectService', () => {
  it('creates projects, lists them and sets the active project', async () => {
    const { opened, service } = createService();
    const workspace = mkdtempSync(join(tmpdir(), 'itstudio-workspace-'));
    directories.push(workspace);
    const created = await service.create('Sample', workspace);
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect((await service.list()).ok).toBe(true);
      expect((await service.setActive(created.value.id)).ok).toBe(true);
    }
    opened.client.close();
  });

  it('returns documented error codes for invalid roots and duplicates', async () => {
    const { opened, service } = createService();
    const workspace = mkdtempSync(join(tmpdir(), 'itstudio-workspace-'));
    directories.push(workspace);
    const file = join(workspace, 'file.txt');
    writeFileSync(file, 'x');
    expect(await service.create('relative', 'relative')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(await service.create('missing', join(workspace, 'missing'))).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await service.create('file', file)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(await service.create('root', parse(workspace).root)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect((await service.create('one', workspace)).ok).toBe(true);
    expect(await service.create('duplicate', workspace)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    opened.client.close();
  });
});
