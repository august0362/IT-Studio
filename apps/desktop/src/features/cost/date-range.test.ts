import { describe, expect, it } from 'vitest';
import type { IsoDateTime } from '@itstudio/schemas';
import { getDateRange } from './date-range';

describe('getDateRange', () => {
  const now = new Date('2026-03-15T16:30:00.000Z');
  it.each([
    ['today', '2026-03-15T00:00:00.000Z', '2026-03-16T00:00:00.000Z'],
    ['last7Days', '2026-03-09T00:00:00.000Z', '2026-03-16T00:00:00.000Z'],
    ['thisMonth', '2026-03-01T00:00:00.000Z', '2026-03-16T00:00:00.000Z'],
    ['lastMonth', '2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'],
    ['allTime', '1970-01-01T00:00:00.000Z', '2026-03-16T00:00:00.000Z'],
  ] as const)('%s returns its UTC half-open range', (preset, from, to) => {
    expect(getDateRange(preset, now)).toEqual({ from, to });
  });
  it('uses a valid custom range and falls back for invalid custom ranges', () => {
    expect(
      getDateRange('custom', now, {
        from: '2026-03-10T00:00:00.000Z' as IsoDateTime,
        to: '2026-03-11T00:00:00.000Z' as IsoDateTime,
      }),
    ).toEqual({ from: '2026-03-10T00:00:00.000Z', to: '2026-03-11T00:00:00.000Z' });
    expect(
      getDateRange('custom', now, {
        from: '2026-03-11T00:00:00.000Z' as IsoDateTime,
        to: '2026-03-10T00:00:00.000Z' as IsoDateTime,
      }),
    ).toEqual(getDateRange('today', now));
    expect(getDateRange('custom', now)).toEqual(getDateRange('today', now));
    expect(getDateRange('custom', now, { from: 'bad' as IsoDateTime, to: 'bad' as IsoDateTime })).toEqual(
      getDateRange('today', now),
    );
  });
});
