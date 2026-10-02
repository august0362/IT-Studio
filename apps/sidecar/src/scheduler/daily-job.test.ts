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
import { SettingsService } from '../services/settings-service.js';
import { FxService } from '../services/fx-service.js';
import { FxDailyJob, type IntervalTimers } from './daily-job.js';
import type { FxRate } from '@itstudio/schemas';

const directories: string[] = [];

function setup(rate = 26_300) {
  const directory = mkdtempSync(join(tmpdir(), 'itstudio-fx-job-'));
  directories.push(directory);
  const opened = openDatabase(directory);
  const seeds = loadSeeds('config');
  if (!seeds.ok) throw new Error(seeds.error.message);
  const clock = createFakeClock(new Date('2026-10-02T00:00:00.000Z'));
  const logger = createLogger({ streams: [] });
  const settings = new SettingsService({
    repository: new SettingsRepository(opened.db),
    defaults: buildDefaultSettings(seeds.value),
    dataDir: directory,
    themeIds: new Set(seeds.value.themes.themes.map((theme) => theme.id)),
    clock,
    logger,
  });
  let latest: FxRate | null = null;
  let calls = 0;
  const fx = new FxService({
    repository: {
      latestAuto: () => latest,
      insert: (value) => {
        latest = value;
      },
    },
    http: {
      request: () => {
        calls += 1;
        return Promise.resolve(Response.json({ rates: { VND: rate } }));
      },
    },
    settings,
    config: seeds.value.fx,
    clock,
    logger,
  });
  return { opened, clock, settings, fx, calls: () => calls };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('FxDailyJob', () => {
  it('runs when due at startup and skips when the latest rate is fresh', async () => {
    const due = setup();
    const dueJob = new FxDailyJob({ ...due, logger: createLogger({ streams: [] }) });
    await dueJob.runIfDue();
    expect(due.calls()).toBe(1);
    const fresh = setup();
    await fresh.fx.initialize();
    await fresh.fx.update();
    const freshJob = new FxDailyJob({ ...fresh, logger: createLogger({ streams: [] }) });
    await freshJob.runIfDue();
    expect(fresh.calls()).toBe(1);
    due.opened.client.close();
    fresh.opened.client.close();
  });

  it('prevents overlapping requests and schedules one daily interval', async () => {
    const setupResult = setup();
    let callback: (() => void) | undefined;
    let cleared = false;
    const timers: IntervalTimers = {
      setInterval: (handler, delayMs) => {
        callback = handler;
        return setInterval(() => undefined, delayMs);
      },
      clearInterval: (timer) => {
        cleared = true;
        clearInterval(timer);
      },
    };
    const job = new FxDailyJob({ ...setupResult, logger: createLogger({ streams: [] }), timers });
    job.start();
    expect(callback).toBeDefined();
    const a = job.runIfDue();
    const b = job.runIfDue();
    await Promise.all([a, b]);
    expect(setupResult.calls()).toBe(1);
    job.stop();
    expect(cleared).toBe(true);
    setupResult.opened.client.close();
  });
});
