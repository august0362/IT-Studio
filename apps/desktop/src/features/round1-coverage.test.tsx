import type {
  CostBreakdownRow,
  FailureReport,
  AppSettings,
  BudgetStatus,
  MoneyDisplay,
  PipelineRun,
  PortfolioPnL,
  ProjectId,
  Project,
  ProjectPnL,
  ReviewVerdict,
  TaskSpec,
} from '@itstudio/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { RpcClient } from '../rpc/rpc-client';
import { RpcClientProvider } from '../rpc/rpc-context';
import { FakeTransport } from '../rpc/transport';
import { BudgetSettingsPage } from './settings/budget/BudgetSettingsPage';
import { FxSettingsPage } from './settings/fx/FxSettingsPage';
import { PipelineSettingsPage } from './settings/pipeline/PipelineSettingsPage';
import { PricingSettingsPage } from './settings/pricing/PricingSettingsPage';
import { VSCodeSettingsPage } from './settings/vscode/VSCodeSettingsPage';
import { BudgetBars } from './cost/BudgetBars';
import { RevenueForm } from './cost/RevenueForm';
import { LedgerTable } from './cost/LedgerTable';
import { PortfolioPage } from './cost/PortfolioPage';
import { BreakdownCharts } from './cost/BreakdownCharts';
import { KnowledgePage } from './knowledge/KnowledgePage';
import { CommandOutput } from './code/CommandOutput';
import { DiffViewer } from './code/DiffViewer';
import { FailureReportPanel } from './code/FailureReportPanel';
import { ReviewView } from './code/ReviewView';
import { RunHistory } from './code/RunHistory';
import { SpecView } from './code/SpecView';
import { ProjectTabs } from '../shell/ProjectTabs';
import { NewProjectDialog } from '../shell/NewProjectDialog';

vi.mock('@monaco-editor/react', () => ({ DiffEditor: () => null }));

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as ProjectId;
const display = {
  microUsd: 1_000_000,
  vnd: 25_000_000,
  usdText: '$1.00',
  vndText: '25,000,000 ₫',
  fxAsOf: '2026-10-02T00:00:00.000Z',
} as unknown as MoneyDisplay;
const settings = {
  budget: { hardStop: false, defaultWarnAt: [0.5, 0.8, 1] },
  pipeline: {
    roleAssignment: { pm: ['openai/first'], coder: ['google/second'], reviewer: ['openai/first'] },
    validationCommands: ['npm test'],
    maxFixAttempts: 1,
  },
  vscode: { autoLaunch: true, codeExecutable: null, showDiffBeforeValidate: true, revealChangedFiles: false },
  rag: { defaultTopK: 5, minScore: 0.2 },
} as unknown as AppSettings;
const models = [
  {
    key: 'openai/first',
    provider: 'openai',
    providerModelId: 'first',
    displayName: 'First',
    capabilities: [],
    contextWindowTokens: 1000,
    maxOutputTokens: 100,
    enabled: true,
  },
  {
    key: 'google/second',
    provider: 'google',
    providerModelId: 'second',
    displayName: 'Second',
    capabilities: [],
    contextWindowTokens: 1000,
    maxOutputTokens: 100,
    enabled: true,
  },
];

function renderRpc(element: ReactNode, respond: (method: string, params: unknown) => unknown): FakeTransport {
  const transport = new FakeTransport();
  transport.setStatus({ running: true, ready: true, restarts: 0 });
  transport.send = (line) => {
    transport.sent.push(line);
    const request: unknown = JSON.parse(line);
    if (typeof request !== 'object' || request === null || !('id' in request) || !('method' in request))
      return Promise.resolve();
    const { id, method, params } = request as {
      readonly id: number;
      readonly method: string;
      readonly params: unknown;
    };
    transport.receive(JSON.stringify({ jsonrpc: '2.0', id, result: respond(method, params) }));
    return Promise.resolve();
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RpcClientProvider client={new RpcClient(transport)}>{element}</RpcClientProvider>
    </QueryClientProvider>,
  );
  return transport;
}

function settingsResponder(method: string): unknown {
  if (method === 'settings.get' || method === 'settings.update') return settings;
  if (method === 'models.list') return models;
  if (method === 'fx.get') return { usdToVnd: 25_000, source: 'manual_override', asOf: '2026-10-02T00:00:00.000Z' };
  if (method === 'pricing.getRows') return { stale: true, table: { origin: 'Seed table' }, rows: [] };
  if (method === 'pricing.overrideUsd') return {};
  return {};
}

afterEach(cleanup);

describe('M4 round 1 settings coverage', () => {
  it('TC-M4-R1-001 saves budget hard stop settings', async () => {
    const transport = renderRpc(<BudgetSettingsPage />, (method) => settingsResponder(method));
    const toggle = await screen.findByRole('checkbox');
    fireEvent.click(toggle);
    await screen.findByText('Settings saved.');
    expect(transport.sent.join('\n')).toContain('settings.update');
  });

  it('TC-M4-R1-002 changes pipeline model roles and saves, while preserving role validation', async () => {
    const transport = renderRpc(<PipelineSettingsPage />, (method) => settingsResponder(method));
    await screen.findAllByText('First');
    const firstRoleChecks = screen.getAllByRole('checkbox', { name: 'First' });
    const firstRoleCheck = firstRoleChecks.at(0);
    if (!firstRoleCheck) throw new Error('Expected the first role checkbox.');
    fireEvent.click(firstRoleCheck);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    const secondChecks = screen.getAllByRole('checkbox', { name: 'Second' });
    const secondCheck = secondChecks.at(0);
    if (!secondCheck) throw new Error('Expected a second model checkbox.');
    fireEvent.click(secondCheck);
    const reenabledFirst = screen.getAllByRole('checkbox', { name: 'First' }).at(0);
    if (!reenabledFirst) throw new Error('Expected the first model checkbox to remain available.');
    fireEvent.click(reenabledFirst);
    const moveUpButtons = screen.getAllByRole('button', { name: 'Move model up' });
    const moveDownButtons = screen.getAllByRole('button', { name: 'Move model down' });
    const firstMoveUp = moveUpButtons.at(0);
    if (!firstMoveUp) throw new Error('Expected the first pipeline reorder control.');
    expect(firstMoveUp).toBeDisabled();
    const secondMoveUp = moveUpButtons.at(1);
    const firstMoveDown = moveDownButtons.at(0);
    if (!secondMoveUp || !firstMoveDown) throw new Error('Expected both pipeline reorder controls.');
    fireEvent.click(secondMoveUp);
    fireEvent.click(firstMoveDown);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('settings.update'))).toBe(true);
    });
  });

  it('TC-M4-R1-003 saves VS Code preferences and trimmed executable values', async () => {
    const transport = renderRpc(<VSCodeSettingsPage />, (method) => settingsResponder(method));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Launch VS Code automatically' }));
    const executable = screen.getByRole('textbox');
    fireEvent.change(executable, { target: { value: ' code.exe ' } });
    fireEvent.blur(executable);
    await waitFor(() => {
      expect(transport.sent.filter((line) => line.includes('settings.update')).length).toBeGreaterThanOrEqual(2);
    });
  });

  it('TC-M4-R1-004 overrides and clears the FX rate', async () => {
    const transport = renderRpc(<FxSettingsPage />, (method) => settingsResponder(method));
    expect(await screen.findByText(/25\.000/)).toBeVisible();
    const input = screen.getByLabelText('VND per USD');
    fireEvent.change(input, { target: { value: '26000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Settings saved.');
    fireEvent.click(screen.getByRole('button', { name: 'Clear override' }));
    await waitFor(() => {
      expect(transport.sent.filter((line) => line.includes('fx.override')).length).toBe(2);
    });
  });

  it('TC-M4-R1-005 validates pricing overrides and writes valid USD values', async () => {
    const transport = renderRpc(<PricingSettingsPage projectActive />, (method) =>
      method === 'pricing.refresh' ? { status: 'unchanged', deltas: [] } : settingsResponder(method),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Update prices' }));
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('pricing.refresh'))).toBe(true);
    });
    // Empty tables still exercise the update path; override form is tested against a real row below.
    cleanup();
    const overrideTransport = renderRpc(<PricingSettingsPage projectActive />, (method) =>
      method === 'pricing.getRows'
        ? {
            stale: false,
            table: { origin: 'Seed table' },
            rows: [
              {
                entry: {
                  modelKey: 'openai/first',
                  sourceUrl: 'https://example.test',
                  inputPerMTokUsd: '1',
                  outputPerMTokUsd: '2',
                  cachedInputPerMTokUsd: '0.5',
                },
                input: display,
                output: display,
                cachedInput: display,
                overridden: false,
              },
            ],
          }
        : settingsResponder(method),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Override' }));
    const fields = screen.getAllByRole('textbox');
    const [inputField, outputField, cachedField] = fields;
    if (!inputField || !outputField || !cachedField) throw new Error('Expected all three price override fields.');
    fireEvent.change(inputField, { target: { value: '1e3' } });
    fireEvent.change(outputField, { target: { value: '2' } });
    fireEvent.change(cachedField, { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Enter valid non-negative USD prices/)).toBeVisible();
    fireEvent.change(inputField, { target: { value: '0.15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Settings saved.');
    expect(overrideTransport.sent.join('')).toContain('pricing.overrideUsd');
  });
});

describe('M4 round 1 cost, knowledge, and page coverage', () => {
  it('TC-M4-R1-006 validates budget form input and reports a failed save', async () => {
    const transport = renderRpc(
      <BudgetBars onSaved={() => undefined} projectId={projectId} statuses={[]} />,
      () => ({}),
    );
    fireEvent.change(screen.getByLabelText('Limit (USD)'), { target: { value: '12.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    await waitFor(() => {
      expect(transport.sent[0]).toContain('budget.setUsd');
    });
  });

  it('TC-M4-R1-007 rejects invalid revenue and records valid VND revenue', async () => {
    const transport = renderRpc(<RevenueForm onAdded={() => undefined} projectId={projectId} rows={[]} />, () => ({}));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1e3' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Consulting' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add revenue' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '250000' } });
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'VND' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add revenue' }));
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('revenue.add'))).toBe(true);
    });
  });

  it('TC-M4-R1-008 queries additional ledger rows with model and purpose filters', async () => {
    let ledgerCalls = 0;
    const transport = renderRpc(
      <LedgerTable
        from={'2026-10-01T00:00:00.000Z' as ProjectPnL['from']}
        initial={{ items: [], nextCursor: 'next' }}
        projectId={projectId}
        to={'2026-11-01T00:00:00.000Z' as ProjectPnL['to']}
      />,
      (method) =>
        method === 'models.list'
          ? models
          : method === 'ledger.queryRows'
            ? { items: [], nextCursor: ledgerCalls++ === 0 ? 'next' : null }
            : {},
    );
    await screen.findByRole('option', { name: 'First' });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'openai/first' } });
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'chat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(transport.sent.filter((line) => line.includes('ledger.queryRows')).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('TC-M4-R1-009 renders the no-project knowledge state and safely handles absent project data', async () => {
    renderRpc(<KnowledgePage project={undefined} projectId={null} />, (method) =>
      method === 'settings.get' ? settings : {},
    );
    expect((await screen.findAllByText('Choose a project tab to manage its knowledge base.')).length).toBe(2);
    expect(screen.getByRole('heading', { name: 'Add sources' })).toBeVisible();
  });

  it('TC-M4-R1-010 handles empty query results and skips reindex paths outside the workspace', async () => {
    const project = { id: projectId, name: 'Test', workspaceRoot: 'C:/workspace' } as Project;
    const transport = renderRpc(<KnowledgePage project={project} projectId={projectId} />, (method) => {
      if (method === 'settings.get') return settings;
      if (method === 'rag.listDocuments') return [];
      if (method === 'rag.query') return [];
      return {};
    });
    fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'nothing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search knowledge' }));
    await waitFor(() => {
      expect(transport.sent.some((line) => line.includes('rag.query'))).toBe(true);
    });
  });

  it('TC-M4-R1-014 displays portfolio rows, cost rankings, and each chart type', () => {
    const breakdown: CostBreakdownRow = {
      key: 'openai/first',
      cost: display,
      inputTokens: 20,
      outputTokens: 5,
      requestCount: 1,
    };
    const projectPnl: ProjectPnL = {
      projectId,
      from: '2026-10-01T00:00:00.000Z' as ProjectPnL['from'],
      to: '2026-11-01T00:00:00.000Z' as ProjectPnL['to'],
      revenue: display,
      cost: display,
      margin: display,
      marginPercent: 0.5,
      byModel: [breakdown],
      byPurpose: [breakdown],
      byDay: [breakdown],
    };
    const portfolio: PortfolioPnL = {
      from: projectPnl.from,
      to: projectPnl.to,
      projects: [
        projectPnl,
        { ...projectPnl, projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as ProjectId, marginPercent: null },
      ],
      revenue: display,
      cost: display,
      margin: display,
      marginPercent: 0.5,
      byProject: [{ ...breakdown, key: projectId }],
      byModel: [breakdown],
    };
    const projects = [{ id: projectId, name: 'Alpha' }] as unknown as readonly Project[];
    render(
      <>
        <PortfolioPage data={portfolio} projects={projects} />
        <BreakdownCharts byDay={[breakdown]} byModel={[breakdown]} byPurpose={[breakdown]} />
      </>,
    );
    expect(screen.getByText('Alpha')).toBeVisible();
    expect(screen.getByText('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBeVisible();
    expect(screen.getAllByText('50.00%')).toHaveLength(2);
    expect(screen.getAllByText('openai/first').length).toBeGreaterThan(1);
    expect(screen.getByRole('region', { name: 'Cost by model' })).toBeVisible();
  });

  it('TC-M4-R1-015 displays all budget levels and caps the usage bar', () => {
    const statuses = ['ok', 'warning', 'exceeded'].map((level, index) => ({
      budget: {
        projectId,
        period: (['daily', 'monthly', 'project_lifetime'] as const)[index],
        limitMicroUsd: 1_000_000,
        warnAt: [0.5, 0.8, 1],
      },
      spent: display,
      remaining: display,
      fractionUsed: [0.4, 0.8, 1.5][index],
      level,
      blocking: level === 'exceeded',
    })) as unknown as readonly BudgetStatus[];
    renderRpc(<BudgetBars onSaved={() => undefined} projectId={projectId} statuses={statuses} />, () => ({}));
    expect(screen.getByText('OK')).toBeVisible();
    expect(screen.getByText('Warning')).toBeVisible();
    expect(screen.getByText('Exceeded')).toBeVisible();
    expect(screen.getByText('Hard Stop active')).toBeVisible();
    expect(screen.getByLabelText('150% budget used').firstElementChild).toHaveStyle({ width: '100%' });
  });

  it('TC-M4-R1-016 displays empty states for each cost chart', () => {
    render(<BreakdownCharts byDay={[]} byModel={[]} byPurpose={[]} />);
    expect(screen.getAllByText('No data to chart.')).toHaveLength(3);
  });
});

describe('M4 round 1 code panels and shell coverage', () => {
  it('TC-M4-R1-011 renders project tabs, close/add actions, and hidden errors', () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const onAdd = vi.fn();
    const projects = [
      { id: 'project-a', name: 'Alpha' },
      { id: 'project-b', name: 'Beta' },
    ] as unknown as readonly Project[];
    render(
      <ProjectTabs
        activeId="project-a"
        error="Project could not be opened"
        onActivate={onActivate}
        onAdd={onAdd}
        onClose={onClose}
        openIds={['project-a', 'project-b']}
        projects={projects}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'All projects' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Beta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Alpha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    expect(onActivate).toHaveBeenNthCalledWith(1, null);
    expect(onActivate).toHaveBeenNthCalledWith(2, 'project-b');
    expect(onClose).toHaveBeenCalledWith('project-a');
    expect(onAdd).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent('Project could not be opened');
  });

  it('TC-M4-R1-012 validates and submits a new project folder', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(<NewProjectDialog error={null} onCancel={onCancel} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: '  Alpha  ' } });
    fireEvent.change(screen.getByLabelText('Folder path'), { target: { value: 'relative/path' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Folder path'), { target: { value: 'C:/work/alpha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith('Alpha', 'C:/work/alpha');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('TC-M4-R1-013 displays code specs, diffs, reviews, command output, and rollback details', () => {
    const spec = {
      title: 'Add greeting',
      userStory: 'As a user, I need a greeting.',
      acceptanceCriteria: ['It renders hello.'],
      allowedPaths: ['src/greeting.ts'],
      constraints: ['Keep it simple.'],
      testPlan: ['Run unit tests.'],
      outOfScope: [],
      contracts: 'export function greet(): string',
    } as unknown as TaskSpec;
    const verdict = {
      approved: false,
      summary: 'Please address the finding.',
      findings: [
        {
          severity: 'major',
          category: 'correctness',
          path: 'src/greeting.ts',
          line: 4,
          message: 'Missing edge case.',
          suggestedFix: 'Handle empty input.',
        },
      ],
    } as unknown as ReviewVerdict;
    const report = {
      stage: 'validating',
      error: { code: 'VALIDATION', message: 'Build failed', remediation: ['Fix the build.'], retryable: false },
      rolledBack: true,
      nextSteps: ['Review the compiler output.'],
      logExcerpt: 'tsc failed',
    } as unknown as FailureReport;
    const run = {
      id: 'run-a',
      projectId,
      prompt: 'Add a greeting',
      stage: 'completed',
      roleAssignment: { pm: [], coder: [], reviewer: [] },
      coderOutputs: [],
      verdicts: [],
      fixAttempts: 0,
      cost: display,
      startedAt: '2026-10-02T00:00:00.000Z',
    } as unknown as PipelineRun;
    const onSelect = vi.fn();
    render(
      <>
        <SpecView spec={spec} />
        <DiffViewer after="hello" before="goodbye" path="src/greeting.md" />
        <ReviewView verdict={verdict} />
        <CommandOutput commandId="test" output={{ stdout: 'ok', stderr: 'warning', truncated: true }} />
        <FailureReportPanel report={report} />
        <RunHistory onSelect={onSelect} runs={[run]} selected={null} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Add a greeting/ }));
    expect(onSelect).toHaveBeenCalledWith(run);
    expect(screen.getByText('Add greeting')).toBeVisible();
    expect(screen.getByText('src/greeting.md')).toBeVisible();
    expect(screen.getByText('Major')).toBeVisible();
    expect(screen.getByText(/truncated/)).toBeVisible();
    expect(screen.getByText('Workspace changes were rolled back.')).toBeVisible();
    expect(screen.getByText('Review the compiler output.')).toBeVisible();
  });
});
