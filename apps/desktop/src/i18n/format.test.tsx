import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatNumber } from './format';

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

describe('desktop locale formatting', () => {
  it('formats numbers with the app locale and options', () => {
    expect(formatNumber(25000, 'en', { maximumFractionDigits: 0 })).toBe('25,000');
    expect(formatNumber(25000, 'vi', { maximumFractionDigits: 0 })).toBe('25.000');
    expect(formatNumber(25000, 'fr', { maximumFractionDigits: 0 })).toBe('25,000');
  });

  it('formats dates and date times with the app locale', () => {
    const instant = '2026-10-02T13:05:00.000Z';
    const date = new Date(instant);
    expect(formatDate(instant, 'en')).toBe(new Intl.DateTimeFormat('en-US', { dateStyle: 'short' }).format(date));
    expect(formatDate(instant, 'vi')).toBe(new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(date));
    expect(formatDateTime(instant, 'en')).toBe(
      new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short' }).format(date),
    );
    expect(formatDateTime(instant, 'vi')).toBe(
      new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date),
    );
  });

  it('TC-M4-R2-001 prevents desktop source from using the operating system locale', () => {
    const files = sourceFiles(join(process.cwd(), 'apps/desktop/src'));
    const forbidden = [`Intl.NumberFormat(${['un', 'defined'].join('')}`, '.toLocaleString()', '.toLocaleDateString()'];
    const offending = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return forbidden.some((pattern) => source.includes(pattern));
    });
    expect(offending).toEqual([]);
  });
});
