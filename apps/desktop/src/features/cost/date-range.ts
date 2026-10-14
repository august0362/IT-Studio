import type { IsoDateTime } from '@itstudio/schemas';

export type DatePreset = 'today' | 'last7Days' | 'thisMonth' | 'lastMonth' | 'allTime' | 'custom';
export interface DateRange {
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
}

function iso(date: Date): IsoDateTime {
  return date.toISOString() as IsoDateTime;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseUtcDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

export function parseCustomDateRange(fromInput: string, toInput: string): DateRange | undefined {
  const from = parseUtcDay(fromInput);
  const to = parseUtcDay(toInput);
  if (from === null || to === null) return undefined;
  const exclusiveTo = new Date(to.getTime() + 86_400_000);
  if (exclusiveTo.getUTCFullYear() > 9999) return undefined;
  return { from: iso(from), to: iso(exclusiveTo) };
}

export function getDateRange(preset: DatePreset, now = new Date(), custom?: DateRange): DateRange {
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  if (preset === 'today') return { from: iso(today), to: iso(tomorrow) };
  if (preset === 'last7Days') return { from: iso(new Date(today.getTime() - 6 * 86_400_000)), to: iso(tomorrow) };
  if (preset === 'thisMonth')
    return { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: iso(tomorrow) };
  if (preset === 'lastMonth')
    return {
      from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))),
      to: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))),
    };
  if (preset === 'allTime') return { from: '1970-01-01T00:00:00.000Z' as IsoDateTime, to: iso(tomorrow) };
  if (custom !== undefined && custom.from < custom.to) return custom;
  return { from: iso(today), to: iso(tomorrow) };
}
