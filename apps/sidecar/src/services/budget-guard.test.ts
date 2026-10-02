import { describe, expect, it } from 'vitest';
import {
  ErrorCode,
  type Budget,
  type BudgetStatus,
  type FxRate,
  type MicroUsd,
  type RpcNotificationMap,
} from '@itstudio/schemas';
import { loadSeeds } from '../config/load-seeds.js';
import { buildDefaultSettings } from '../domain/default-settings.js';
import { createFakeClock } from '../infra/clock.js';
import { createLogger } from '../infra/logger.js';
import { openDatabase } from '../infra/sqlite/database.js';
import { SettingsRepository } from '../infra/sqlite/settings-repository.js';
import type { BudgetAlertKey, IBudgetRepository } from '../ports/budget-repository.js';
import type { IPriceSource } from './price-source.js';
import { EventBus } from '../rpc/event-bus.js';
import { projectIdSchema } from '../validation/brand.js';
import { microUsd } from '../domain/cost.js';
import { isoDateTimeSchema } from '../validation/brand.js';
import { SettingsService } from './settings-service.js';
import { BudgetGuard } from './budget-guard.js';

const projectId = projectIdSchema.parse('00000000-0000-4000-8000-000000000021');

function harness(initial: Date, limits: readonly Budget[] = []) {
  const seeds = loadSeeds('config');
  if (!seeds.ok) throw new Error(seeds.error.message);
  const database = openDatabase(':memory:');
  const clock = createFakeClock(initial);
  const settings = new SettingsService({
    repository: new SettingsRepository(database.db),
    defaults: buildDefaultSettings(seeds.value),
    dataDir: '.',
    themeIds: new Set(seeds.value.themes.themes.map((theme) => theme.id)),
    clock,
    logger: createLogger({ streams: [] }),
  });
  const current = [...limits];
  const alerts = new Set<string>();
  let spent: MicroUsd = microUsd(0);
  const repository: IBudgetRepository = {
    list: (id) => Promise.resolve(current.filter((budget) => budget.projectId === id)),
    upsert: (budget) => {
      const index = current.findIndex((item) => item.projectId === budget.projectId && item.period === budget.period);
      if (index === -1) current.push(budget);
      else current[index] = budget;
      return Promise.resolve();
    },
    spent: () => Promise.resolve(spent),
    recordAlert: (key: BudgetAlertKey) => {
      const token = `${key.projectId}:${key.period}:${key.windowKey}:${String(key.threshold)}`;
      if (alerts.has(token)) return Promise.resolve(false);
      alerts.add(token);
      return Promise.resolve(true);
    },
  };
  const fx: FxRate = {
    usdToVnd: 26_000,
    asOf: isoDateTimeSchema.parse('2026-10-02T00:00:00.000Z'),
    source: 'auto',
  };
  const prices: IPriceSource = { getPriceTable: () => seeds.value.pricing, getFxRate: () => fx };
  const events = new EventBus<RpcNotificationMap>();
  const published: BudgetStatus[] = [];
  events.subscribe('budget.alert', (event) => {
    published.push(event);
  });
  return {
    guard: new BudgetGuard({ repository, settings, prices, events, clock }),
    settings,
    published,
    alerts,
    setSpent: (value: number): void => {
      spent = microUsd(value);
    },
    advance: (milliseconds: number): void => {
      clock.advance(milliseconds);
    },
    close: (): void => {
      database.client.close();
    },
  };
}

function budget(period: Budget['period'], limitMicroUsd = 100, warnAt: readonly number[] = [0.5, 0.8, 1]): Budget {
  return { projectId, period, limitMicroUsd: microUsd(limitMicroUsd), warnAt };
}

describe('BudgetGuard', () => {
  it('TC-M3-031 alerts at 50 percent and not below the threshold', async () => {
    const h = harness(new Date('2026-10-02T12:00:00.000Z'), [budget('monthly', 1_000_000)]);
    h.setSpent(499_900);
    await h.guard.check(projectId, 0);
    expect(h.published).toHaveLength(0);
    await h.guard.check(projectId, 100);
    expect(h.published.map((event) => event.level)).toEqual(['warning']);
    h.close();
  });

  it('TC-M3-032 alerts once at each configured threshold including 100 percent', async () => {
    const h = harness(new Date('2026-10-02T12:00:00.000Z'), [budget('monthly', 1_000_000)]);
    for (const [spent, estimate] of [
      [499_900, 100],
      [799_900, 100],
      [999_900, 100],
      [999_900, 100],
    ] as const) {
      h.setSpent(spent);
      await h.guard.check(projectId, estimate);
    }
    expect(h.published.map((event) => event.fractionUsed)).toEqual([0.5, 0.8, 1]);
    expect(h.published.at(-1)?.level).toBe('exceeded');
    h.close();
  });

  it('TC-M3-033 alerts once for crossed thresholds in a window and alerts again in the next window', async () => {
    const h = harness(new Date('2026-10-02T23:59:00.000Z'), [budget('daily')]);
    h.setSpent(40);
    await expect(h.guard.check(projectId, 45)).resolves.toMatchObject({ ok: true, value: { level: 'warning' } });
    await h.guard.check(projectId, 45);
    expect(h.published).toHaveLength(2);
    expect(h.published.map((status) => status.fractionUsed)).toEqual([0.85, 0.85]);
    h.advance(60_000);
    await h.guard.check(projectId, 45);
    expect(h.published).toHaveLength(4);
    h.close();
  });

  it('honors Hard Stop for exceeded projections while warning when disabled', async () => {
    const h = harness(new Date('2026-10-02T12:00:00.000Z'), [budget('monthly')]);
    h.setSpent(80);
    await expect(h.guard.check(projectId, 20)).resolves.toMatchObject({
      ok: true,
      value: { level: 'exceeded', blocking: false },
    });
    await h.settings.update({ budget: { hardStop: true } });
    await expect(h.guard.check(projectId, 20)).resolves.toMatchObject({
      ok: true,
      value: { level: 'exceeded', blocking: true },
    });
    expect(h.published).toHaveLength(1);
    h.close();
  });

  it('combines multiple budgets and rejects invalid threshold ordering', async () => {
    const h = harness(new Date('2026-10-02T12:00:00.000Z'), [budget('daily', 100), budget('monthly', 1_000)]);
    h.setSpent(400);
    await expect(h.guard.check(projectId, 100)).resolves.toMatchObject({
      ok: true,
      value: { level: 'exceeded', blocking: false },
    });
    const invalid = await h.guard.set(budget('daily', 100, [0.8, 0.5]));
    expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    await expect(h.guard.set(budget('daily', 0))).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    await expect(h.guard.set(budget('daily', 100, [Number.NaN]))).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    h.close();
  });

  it('TC-M3-034 resets daily and monthly alert windows at UTC boundaries including leap day', async () => {
    const daily = harness(new Date('2028-02-28T23:59:59.000Z'), [budget('daily')]);
    daily.setSpent(40);
    await daily.guard.check(projectId, 10);
    daily.advance(1_000);
    daily.setSpent(0);
    await daily.guard.check(projectId, 50);
    expect(daily.published).toHaveLength(2);
    daily.close();

    const monthly = harness(new Date('2028-02-29T23:59:59.000Z'), [budget('monthly')]);
    monthly.setSpent(40);
    await monthly.guard.check(projectId, 10);
    monthly.advance(1_000);
    monthly.setSpent(0);
    await monthly.guard.check(projectId, 50);
    expect(monthly.published).toHaveLength(2);
    monthly.close();
  });

  it('TC-M3-035 blocks an estimate that projects spending over the limit before dispatch', async () => {
    const h = harness(new Date('2026-10-02T12:00:00.000Z'), [budget('monthly', 1_000_000)]);
    h.setSpent(990_000);
    await h.settings.update({ budget: { hardStop: true } });
    await expect(h.guard.check(projectId, 20_000)).resolves.toMatchObject({
      ok: true,
      value: { level: 'exceeded', blocking: true },
    });
    h.close();
  });

  it('parses a USD decimal string to integer micro-USD', async () => {
    const h = harness(new Date('2026-10-02T12:00:00.000Z'));
    await expect(
      h.guard.setUsd({ projectId, period: 'monthly', limitUsd: '12.5', warnAt: [0.5, 0.8, 1] }),
    ).resolves.toMatchObject({ ok: true, value: { budget: { limitMicroUsd: 12_500_000 } } });
    await expect(
      h.guard.setUsd({ projectId, period: 'monthly', limitUsd: '1e3', warnAt: [0.5] }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    for (const limitUsd of ['0', '-1', '', '1.0000001']) {
      await expect(
        h.guard.setUsd({ projectId, period: 'monthly', limitUsd, warnAt: [0.5, 0.8, 1] }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    }
    await expect(
      h.guard.setUsd({ projectId, period: 'monthly', limitUsd: '12.5', warnAt: [0.8, 0.5] }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    await expect(
      h.guard.setUsd({ projectId, period: 'monthly', limitUsd: '12.5', warnAt: [1, 1.1] }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    h.close();
  });

  it('TC-M3-038 lets the daily budget determine blocking when the monthly budget is under its limit', async () => {
    const h = harness(new Date('2026-10-02T12:00:00.000Z'), [budget('daily', 100), budget('monthly', 1_000)]);
    h.setSpent(150);
    await h.settings.update({ budget: { hardStop: true } });
    await expect(h.guard.check(projectId, 0)).resolves.toMatchObject({
      ok: true,
      value: { level: 'exceeded', blocking: true },
    });
    h.close();
  });

  it('returns ok with no configured budgets and rejects an invalid estimate', async () => {
    const h = harness(new Date('2026-10-02T12:00:00.000Z'));
    await expect(h.guard.check(projectId, 0)).resolves.toMatchObject({
      ok: true,
      value: { level: 'ok', blocking: false },
    });
    await expect(h.guard.check(projectId, -1)).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    await expect(h.guard.status(projectId)).resolves.toMatchObject({ ok: true, value: [] });
    h.close();
  });

  it('fails open when reading settings fails and reports configured budget status', async () => {
    const h = harness(new Date('2026-10-02T12:00:00.000Z'), [budget('monthly')]);
    await expect(h.guard.status(projectId)).resolves.toMatchObject({ ok: true, value: [{ level: 'ok' }] });
    h.settings.get = () =>
      Promise.resolve({
        ok: false,
        error: {
          code: ErrorCode.INTERNAL,
          message: 'Settings could not be read.',
          retryable: false,
          remediation: ['Restart the app.'],
        },
      });
    await expect(h.guard.check(projectId, 0)).resolves.toMatchObject({ ok: true, value: { blocking: false } });
    h.close();
  });
});
