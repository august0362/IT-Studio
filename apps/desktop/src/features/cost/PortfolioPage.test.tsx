import type { PortfolioPnL, Project } from '@itstudio/schemas';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import '../../i18n';
import { PortfolioPage } from './PortfolioPage';

afterEach(cleanup);

it('M9-OBS-06 labels top project spend by name and shortens only missing project ids', () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as Project['id'];
  const missing = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const money = { microUsd: 0, vnd: 0, usdText: '$0.00', vndText: '0 ₫' } as PortfolioPnL['cost'];
  const counts = { inputTokens: 0, outputTokens: 0, requestCount: 0 };
  const data: PortfolioPnL = {
    from: '2026-10-01T00:00:00.000Z' as PortfolioPnL['from'],
    to: '2026-11-01T00:00:00.000Z' as PortfolioPnL['to'],
    revenue: money,
    cost: money,
    margin: money,
    marginPercent: null,
    projects: [],
    byProject: [
      { ...counts, key: id, cost: money },
      { ...counts, key: missing, cost: money },
    ],
    byModel: [{ ...counts, key: 'openai/test-model', cost: money }],
  };
  render(
    <PortfolioPage
      data={data}
      projects={[{ id, name: 'Client website', workspaceRoot: 'C:/client', createdAt: data.from, archived: false }]}
    />,
  );
  const section = screen.getByRole('heading', { name: 'Top spend by project' }).parentElement;
  if (section === null) throw new Error('Missing project spend section');
  expect(within(section).getByText('Client website')).toBeVisible();
  expect(within(section).getByText('bbbbbbbb')).toBeVisible();
  expect(within(section).queryByText(id)).not.toBeInTheDocument();
  expect(screen.getByText('openai/test-model')).toBeVisible();
});
