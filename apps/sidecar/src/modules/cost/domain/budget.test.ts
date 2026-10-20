import { describe, expect, it } from 'vitest';
import { budgetLevel, crossedThresholds, fractionUsed, periodWindow } from './budget.js';

describe('budget domain', () => {
  it('classifies threshold boundaries and fractions', () => {
    expect(fractionUsed(4_999, 10_000)).toBe(0.4999);
    expect(budgetLevel(0.4999, [0.5, 0.8, 1])).toBe('ok');
    expect(budgetLevel(0.5, [0.5, 0.8, 1])).toBe('warning');
    expect(budgetLevel(0.8, [0.5, 0.8, 1])).toBe('warning');
    expect(budgetLevel(0.9999, [0.5, 0.8, 1])).toBe('warning');
    expect(budgetLevel(1, [0.5, 0.8, 1])).toBe('exceeded');
    expect(budgetLevel(0.7, [1])).toBe('ok');
  });

  it('returns UTC day windows across midnight', () => {
    const window = periodWindow('daily', new Date('2026-10-02T00:00:00.001Z'));
    expect(window.from?.toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });

  it.each(['2024-02-28T22:00:00.000Z', '2024-02-29T22:00:00.000Z', '2026-02-28T22:00:00.000Z'])(
    'handles month-end from %s',
    (now) => {
      const window = periodWindow('monthly', new Date(now));
      expect(window.from?.toISOString()).toBe(`${now.slice(0, 7)}-01T00:00:00.000Z`);
      expect(window.to.toISOString()).toBe(
        `${now.slice(0, 4)}-${String(Number(now.slice(5, 7)) + 1).padStart(2, '0')}-01T00:00:00.000Z`,
      );
    },
  );

  it('uses a stable project lifetime window and reports crossed thresholds', () => {
    const window = periodWindow('project_lifetime', new Date('2026-10-02T12:00:00.000Z'));
    expect(window).toEqual({ key: 'lifetime', to: new Date('2026-10-02T12:00:00.000Z') });
    expect(crossedThresholds(0.49, 1, [0.5, 0.8, 1])).toEqual([0.5, 0.8, 1]);
    expect(crossedThresholds(0.8, 0.99, [0.5, 0.8, 1])).toEqual([]);
  });
});
