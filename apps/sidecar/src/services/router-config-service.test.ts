import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSeeds } from '../config/load-seeds.js';
import { buildDefaultSettings } from '../domain/default-settings.js';
import { createFakeClock } from '../infra/clock.js';
import { openDatabase } from '../infra/sqlite/database.js';
import { SettingsRepository } from '../infra/sqlite/settings-repository.js';
import { createLogger } from '../infra/logger.js';
import { modelKeySchema } from '../validation/common.js';
import { ModelRegistry } from './model-registry.js';
import { ProviderRegistry } from '../providers/provider-registry.js';
import { SettingsService } from './settings-service.js';
import { RouterConfigService } from './router-config-service.js';

const directories: string[] = [];
function createHarness() {
  const directory = mkdtempSync(join(tmpdir(), 'itstudio-router-config-'));
  directories.push(directory);
  const opened = openDatabase(directory);
  const loaded = loadSeeds('config');
  if (!loaded.ok) throw new Error(loaded.error.message);
  const settings = new SettingsService({
    repository: new SettingsRepository(opened.db),
    defaults: buildDefaultSettings(loaded.value),
    dataDir: directory,
    themeIds: new Set(loaded.value.themes.themes.map((theme) => theme.id)),
    clock: createFakeClock(new Date('2026-10-02T00:00:00.000Z')),
    logger: createLogger({ streams: [] }),
  });
  const models = new ModelRegistry(loaded.value.models, new ProviderRegistry({}));
  return { opened, settings, service: new RouterConfigService({ settings, models }) };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('RouterConfigService', () => {
  it('rejects duplicate priorities, unknown models, and out-of-range values', async () => {
    const h = createHarness();
    const initial = await h.service.getConfig();
    if (!initial.ok) throw new Error(initial.error.message);
    const [first, second] = initial.value.ladder;
    if (first === undefined || second === undefined) throw new Error('Expected at least two seeded models');
    const duplicate = {
      ...initial.value,
      ladder: [{ ...first, priority: 1 }, { ...second, priority: 1 }, ...initial.value.ladder.slice(2)],
    };
    const unknown = { ...initial.value, lockedModelKey: modelKeySchema.parse('openai/made-up') };
    const tooManyRetries = {
      ...initial.value,
      ladder: [{ ...first, maxRetries: 6 }, ...initial.value.ladder.slice(1)],
    };
    const tooShortTimeout = {
      ...initial.value,
      ladder: [{ ...first, timeoutMs: 4_999 }, ...initial.value.ladder.slice(1)],
    };
    const tooLongDecision = { ...initial.value, userDecisionTimeoutMs: 600_001 };
    for (const invalid of [duplicate, unknown, tooManyRetries, tooShortTimeout, tooLongDecision]) {
      expect(await h.service.updateConfig(invalid)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    }
    h.opened.client.close();
  });

  it('renumbers by submitted priority and persists the config round-trip', async () => {
    const h = createHarness();
    const initial = await h.service.getConfig();
    if (!initial.ok) throw new Error(initial.error.message);
    const [first, second, ...rest] = initial.value.ladder;
    if (first === undefined || second === undefined) throw new Error('Expected at least two seeded models');
    const changed = {
      ...initial.value,
      autoFallback: false,
      ladder: [
        { ...first, priority: 20 },
        { ...second, priority: 10 },
        ...rest.map((entry, index) => ({ ...entry, priority: 30 + index })),
      ],
    };
    const updated = await h.service.updateConfig(changed);
    expect(updated.ok && updated.value.ladder.slice(0, 2).map((entry) => entry.modelKey)).toEqual([
      second.modelKey,
      first.modelKey,
    ]);
    expect(updated.ok && updated.value.ladder.map((entry) => entry.priority)).toEqual(
      updated.ok ? updated.value.ladder.map((_, index) => index + 1) : [],
    );
    expect(await h.service.getConfig()).toEqual(updated);
    h.opened.client.close();
  });
});
