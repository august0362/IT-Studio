import type { MoneyDisplay } from '@itstudio/schemas';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Money } from './Money';

function money(microUsd: MoneyDisplay['microUsd']): MoneyDisplay {
  // @ts-expect-error Test values stand in for validated branded sidecar values.
  const vnd: MoneyDisplay['vnd'] = 31_456;
  // @ts-expect-error Test timestamps stand in for validated branded sidecar values.
  return { microUsd, vnd, usdText: '$1.23', vndText: '31.456 ₫', fxAsOf: '2026-10-02T00:00:00.000Z' };
}

afterEach(cleanup);

describe('Money', () => {
  it('renders USD first and muted VND second without reformatting', () => {
    // @ts-expect-error Test values stand in for validated branded sidecar values.
    const value = money(1_230_000);
    render(<Money value={value} />);
    expect(screen.getByLabelText('USD $1.23; VND 31.456 ₫')).toHaveTextContent('$1.2331.456 ₫');
    expect(screen.getByText('31.456 ₫')).toHaveClass('text-sm');
  });

  it('applies danger styling for negative amounts', () => {
    // @ts-expect-error Test values stand in for validated branded sidecar values.
    const value = money(-1);
    render(<Money value={value} />);
    const alert = screen.getByLabelText('USD $1.23; VND 31.456 ₫');
    expect(within(alert).getAllByText('$1.23')[0]).toHaveClass('text-red-700');
  });

  it('renders compact values on one line and exposes both amounts accessibly', () => {
    // @ts-expect-error Test values stand in for validated branded sidecar values.
    const value = money(1);
    render(<Money compact value={value} />);
    expect(screen.getByLabelText('USD $1.23; VND 31.456 ₫')).toHaveTextContent('$1.23 · 31.456 ₫');
    expect(screen.getByLabelText('USD $1.23; VND 31.456 ₫').children).toHaveLength(0);
  });
});
