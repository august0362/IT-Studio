import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSeeds } from '../config/load-seeds.js';
import { buildDefaultSettings } from '../domain/default-settings.js';
import { createFakeClock } from '../infra/clock.js';
import { createLogger } from '../infra/logger.js';
import { openDatabase } from '../infra/sqlite/database.js';
import { SettingsRepository } from '../infra/sqlite/settings-repository.js';
import type { IHttpClient } from '../ports/http-client.js';
import type { FxRate } from '@itstudio/schemas';
import { SettingsService } from './settings-service.js';
import { FxService } from './fx-service.js';

const directories: string[] = [];

function setup(http: IHttpClient = { request: () => Promise.resolve(Response.json({ rates: { VND: 26_300 } })) }) {
  const directory = mkdtempSync(join(tmpdir(), 'itstudio-fx-'));
  directories.push(directory);
  const opened = openDatabase(directory);
  const seeds = loadSeeds('config');
  if (!seeds.ok) throw new Error(seeds.error.message);
  const clock = createFakeClock(new Date('2026-10-02T00:00:00.000Z'));
  const settings = new SettingsService({
    repository: new SettingsRepository(opened.db),
    defaults: buildDefaultSettings(seeds.value),
    dataDir: directory,
    themeIds: new Set(seeds.value.themes.themes.map((theme) => theme.id)),
    clock,
    logger: createLogger({ streams: [] }),
  });
  let latest: FxRate | null = null;
  const service = new FxService({
    repository: {
      latestAuto: () => latest,
      insert: (rate) => {
        latest = rate;
      },
    },
    http,
    settings,
    config: seeds.value.fx,
    clock,
    logger: createLogger({ streams: [] }),
  });
  return { opened, service, settings };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('FxService', () => {
  it('fetches and stores a valid daily rate', async () => {
    const { opened, service } = setup();
    await service.initialize();
    expect(await service.update()).toMatchObject({ ok: true, value: { usdToVnd: 26_300, source: 'auto' } });
    expect(service.latestAuto()?.asOf).toBe('2026-10-02T00:00:00.000Z');
    opened.client.close();
  });

  it.each([
    ['timeout', { request: () => Promise.reject(new DOMException('Timed out', 'TimeoutError')) }],
    ['http error', { request: () => Promise.resolve(new Response(null, { status: 503 })) }],
    ['malformed json', { request: () => Promise.resolve(new Response('{', { status: 200 })) }],
    ['out of bounds', { request: () => Promise.resolve(Response.json({ rates: { VND: 9_999 } })) }],
  ])('rejects %s without storing a rate', async (_name, http) => {
    const { opened, service } = setup(http);
    await service.initialize();
    expect((await service.update()).ok).toBe(false);
    expect(service.latestAuto()).toBeNull();
    opened.client.close();
  });

  it('rejects an automatic change larger than 20 percent', async () => {
    let nextRate = 26_300;
    const { opened, service } = setup({ request: () => Promise.resolve(Response.json({ rates: { VND: nextRate } })) });
    await service.initialize();
    await service.update();
    nextRate = 32_000;
    expect((await service.update()).ok).toBe(false);
    expect(service.latestAuto()?.usdToVnd).toBe(26_300);
    opened.client.close();
  });

  it('uses manual then automatic then seed rates and validates override boundaries', async () => {
    const { opened, service, settings } = setup();
    expect(service.getEffective().usdToVnd).toBe(26_300);
    await service.initialize();
    expect(service.getEffective().usdToVnd).toBe(26_300);
    await service.update();
    const manual = await service.override(25_000);
    expect(manual).toMatchObject({ ok: true, value: { usdToVnd: 25_000, source: 'manual_override' } });
    expect((await service.override(9_999)).ok).toBe(false);
    expect((await service.override(100_001)).ok).toBe(false);
    expect((await service.override(10_000)).ok).toBe(true);
    expect((await service.override(100_000)).ok).toBe(true);
    await service.override(25_000);
    await service.override(null);
    expect(service.getEffective().usdToVnd).toBe(26_300);
    const current = await settings.get();
    expect(current.ok && current.value.fx.manualUsdToVnd).toBeNull();
    opened.client.close();

    const seedFallback = setup();
    await seedFallback.service.initialize();
    await seedFallback.service.override(24_000);
    await seedFallback.service.override(null);
    expect(seedFallback.service.getEffective().usdToVnd).toBe(26_300);
    seedFallback.opened.client.close();
  });
});
