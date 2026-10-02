import { describe, expect, it } from 'vitest';
import type { Project, RevenueEntry } from '@itstudio/schemas';
import { createFakeClock } from '../infra/clock.js';
import type { IProjectRepository } from '../ports/project-repository.js';
import type { IRevenueRepository } from '../ports/revenue-repository.js';
import { isoDateTimeSchema, projectIdSchema } from '../validation/brand.js';
import { RevenueService } from './revenue-service.js';

const projectId = projectIdSchema.parse('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const now = isoDateTimeSchema.parse('2026-10-02T00:00:00.000Z');
const project: Project = { id: projectId, name: 'Test', workspaceRoot: 'C:/test', createdAt: now, archived: false };

function harness() {
  const stored: RevenueEntry[] = [];
  const projectRepository: IProjectRepository = {
    list: () => Promise.resolve([project]),
    get: (id) => Promise.resolve(id === projectId ? project : null),
    getByWorkspaceRoot: () => Promise.resolve(null),
    create: () => Promise.resolve(),
    setArchived: () => Promise.resolve(false),
  };
  const repository: IRevenueRepository = {
    insert: (entry) => {
      stored.push(entry);
      return Promise.resolve();
    },
    list: () => Promise.resolve(stored),
  };
  const rates = { current: { usdToVnd: 25_000, asOf: now, source: 'auto' as const } };
  const service = new RevenueService({
    repository,
    projects: projectRepository,
    fx: { getEffective: () => rates.current },
    ids: { uuid: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    clock: createFakeClock(new Date(now)),
  });
  return { service, stored, rates };
}

describe('RevenueService', () => {
  it('converts USD and VND to rounded integer micro-USD using the effective FX rate', async () => {
    const { service, rates, stored } = harness();
    const usd = await service.add({ projectId, amount: 1.2345678, currency: 'USD', description: '  invoice  ' });
    expect(usd).toMatchObject({
      ok: true,
      value: { amountMicroUsd: 1_234_568, description: 'invoice', occurredAt: now },
    });
    const vnd = await service.add({ projectId, amount: 1, currency: 'VND', description: '' });
    expect(vnd).toMatchObject({ ok: true, value: { amountMicroUsd: 40 } });
    rates.current = { ...rates.current, usdToVnd: 20_000 };
    const overridden = await service.add({ projectId, amount: 1, currency: 'VND', description: 'override' });
    expect(overridden).toMatchObject({ ok: true, value: { amountMicroUsd: 50 } });
    expect(stored).toHaveLength(3);
  });

  it('TC-M3-044 rejects non-positive or non-finite amounts, long descriptions, and unknown projects', async () => {
    const { service } = harness();
    for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await service.add({ projectId, amount, currency: 'USD', description: '' });
      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    }
    expect(await service.add({ projectId, amount: 1, currency: 'USD', description: 'x'.repeat(501) })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    const missing = await service.add({
      projectId: projectIdSchema.parse('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      amount: 1,
      currency: 'USD',
      description: '',
    });
    expect(missing).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('returns revenue rows with a display derived from the current FX rate', async () => {
    const { service } = harness();
    await service.add({ projectId, amount: 2, currency: 'USD', description: 'Invoice' });
    const result = await service.listRows(projectId, '2020-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z');
    expect(result).toMatchObject({
      ok: true,
      value: [{ entry: { amountMicroUsd: 2_000_000 }, amount: { microUsd: 2_000_000, usdText: '$2.00' } }],
    });
  });
});
