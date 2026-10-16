import type { ProcessRecord } from '@itstudio/schemas';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { ProcessCounts } from './ProcessCounts';
import { StatusBar } from '../../components/StatusBar';
import { ProcessesPage } from './ProcessesPage';
import { mountProcesses, processRecord } from './test-support';
import { PROCESS_QUERY_KEY, retainProcesses } from './useProcesses';

const disposers: (() => void)[] = [];
beforeEach(() => {
  void i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  for (const dispose of disposers.splice(0)) dispose();
});
function setup(records: readonly ProcessRecord[]) {
  const open = vi.fn();
  const view = mountProcesses(
    <ProcessesPage projectId={processRecord().projectId ?? null} projects={[]} onOpen={open} />,
    records,
  );
  disposers.push(view.dispose);
  return { ...view, open };
}
describe('PROC-02 processes list', () => {
  it('UX-06 offers Chat from the processes empty state', async () => {
    setup([]);
    expect(await screen.findByText('No matching activity yet. Start in Chat to see your work here.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Chat' })).toHaveAttribute('href', '#chat');
  });
  it('groups every status with labelled colored dots and only the allowed actions', async () => {
    const records = (['running', 'waiting', 'stopped', 'ended'] as const).map((status) =>
      processRecord({
        // @ts-expect-error Readable fixture process identifiers.
        id: status,
        title: status,
        status,
        retryable: true,
      }),
    );
    const view = setup(records);
    await screen.findByText('running');
    for (const record of records) {
      const row = screen.getByText(record.title).closest('li');
      if (!row) throw new Error('Missing row');
      const item = within(row);
      expect(item.getByText(i18n.t(`processes.status.${record.status}`))).toBeVisible();
      expect(row.querySelector('[aria-hidden="true"]')).toHaveClass(`process-dot-${record.status}`);
      expect(item.queryByRole('button', { name: 'Cancel' }) !== null).toBe(
        ['running', 'waiting'].includes(record.status),
      );
      expect(item.queryByRole('button', { name: 'Retry' }) !== null).toBe(record.status === 'stopped');
      expect(item.queryByRole('button', { name: 'Dismiss' }) !== null).toBe(record.status === 'stopped');
      expect(item.queryByRole('button', { name: 'Delete' }) !== null).toBe(
        record.status === 'ended' || record.status === 'stopped',
      );
      fireEvent.click(item.getByRole('button', { name: 'Open' }));
      expect(view.open).toHaveBeenLastCalledWith(record);
    }
  });
  it('applies live upserts/removals without another list call and excludes nonretryable retries', async () => {
    const view = setup([processRecord()]);
    await screen.findByText('Chat request');
    const stopped = processRecord({ status: 'stopped', statusReason: 'Cancelled' });
    act(() => {
      view.notify({ type: 'upsert', process: stopped });
    });
    await waitFor(() => {
      expect(within(screen.getByRole('region', { name: 'Stopped' })).getByText('Chat request')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    act(() => {
      view.notify({ type: 'removed', id: stopped.id });
    });
    await waitFor(() => {
      expect(screen.queryByText('Chat request')).not.toBeInTheDocument();
    });
    expect(view.requests.filter((request) => request.method === 'process.list')).toHaveLength(1);
  });
  it('filters by current project, all projects, kind, search and status chips', async () => {
    const other = processRecord({
      // @ts-expect-error Readable fixture project identifier.
      projectId: 'project-2',
      // @ts-expect-error Readable fixture process identifier.
      id: 'knowledge',
      title: 'Index notes',
      kind: 'knowledge_ingest',
      status: 'waiting',
    });
    const view = setup([processRecord(), other]);
    await screen.findByText('Chat request');
    expect(screen.queryByText('Index notes')).not.toBeInTheDocument();
    expect(view.requests).toContainEqual(expect.objectContaining({ method: 'process.list', params: { limit: 100 } }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'All projects' }));
    await screen.findByText('Index notes');
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind' }), { target: { value: 'knowledge_ingest' } });
    expect(screen.queryByText('Chat request')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search processes'), { target: { value: 'missing' } });
    expect(screen.queryByText('Index notes')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search processes'), { target: { value: 'notes' } });
    expect(screen.getByText('Index notes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Waiting' }));
    expect(screen.queryByText('Index notes')).not.toBeInTheDocument();
  });
  it('keeps only the newest twenty ended records without trimming active records', () => {
    const ended = Array.from({ length: 25 }, (_, index) =>
      processRecord({
        status: 'ended',
        // @ts-expect-error Readable fixture process identifier.
        id: `ended-${String(index)}`,
        // @ts-expect-error Fixed ISO timestamp fixture.
        updatedAt: `2026-10-${String(index + 1).padStart(2, '0')}T01:00:00.000Z`,
      }),
    );
    const result = retainProcesses([processRecord(), ...ended]);
    expect(result).toHaveLength(21);
    expect(result.some((record) => record.id === 'ended-0')).toBe(false);
  });
  it('shows action errors and restores action availability', async () => {
    const view = setup([processRecord()]);
    await screen.findByText('Chat request');
    view.fail('process.cancel');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });
  it('status bar counts update live and click opens processes', async () => {
    const navigate = vi.fn();
    const view = mountProcesses(<StatusBar onProcesses={navigate} />);
    disposers.push(view.dispose);
    await screen.findByLabelText('Running: 1');
    expect(screen.getByLabelText('Waiting: 0')).toBeVisible();
    act(() => {
      view.notify({ type: 'upsert', process: processRecord({ status: 'waiting' }) });
    });
    await screen.findByLabelText('Running: 0');
    expect(screen.getByLabelText('Waiting: 1')).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'Processes' }));
    expect(navigate).toHaveBeenCalledOnce();
  });
});

describe('OWNER-FB3 shared process cache', () => {
  function setupCounts(status: ProcessRecord['status'] = 'stopped') {
    const view = mountProcesses(
      <>
        <aside aria-label="Sidebar badge">
          <ProcessCounts />
        </aside>
        <div role="region" aria-label="Status bar">
          <StatusBar onProcesses={() => undefined} />
        </div>
        <ProcessesPage projectId={processRecord().projectId ?? null} projects={[]} onOpen={() => undefined} />
      </>,
      [processRecord({ status, retryable: true })],
    );
    disposers.push(view.dispose);
    return view;
  }
  it.each(['Dismiss', 'Delete'])(
    'TC-OWNER-FB3-011 %s updates list, sidebar badge and status counts from its response',
    async (action) => {
      const view = setupCounts();
      await screen.findByText('Chat request');
      for (const name of ['Sidebar badge', 'Status bar'])
        expect(within(screen.getByLabelText(name)).getByLabelText('Stopped: 1')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: action }));
      if (action === 'Delete') {
        const dialog = screen.getByRole('alertdialog');
        expect(view.requests.some((request) => request.method === 'process.delete')).toBe(false);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      }
      await waitFor(() => {
        for (const name of ['Sidebar badge', 'Status bar'])
          expect(within(screen.getByLabelText(name)).getByLabelText('Stopped: 0')).toBeVisible();
      });
      if (action === 'Delete') expect(screen.queryByText('Chat request')).not.toBeInTheDocument();
      else expect(within(screen.getByRole('region', { name: 'Ended' })).getByText('Chat request')).toBeVisible();
      expect(view.requests.filter((request) => request.method === 'process.list')).toHaveLength(1);
    },
  );
  it('TC-OWNER-FB3-012 removed events update every consumer without polling', async () => {
    const view = setupCounts();
    await screen.findByText('Chat request');
    act(() => {
      view.notify({ type: 'removed', id: processRecord().id });
    });
    await waitFor(() => {
      expect(screen.queryByText('Chat request')).not.toBeInTheDocument();
    });
    for (const name of ['Sidebar badge', 'Status bar'])
      expect(within(screen.getByLabelText(name)).getByLabelText('Stopped: 0')).toBeVisible();
  });
  it('TC-OWNER-FB3-017 deleting an already removed record clears its stale row and counts', async () => {
    const view = setupCounts();
    await screen.findByText('Chat request');
    act(() => {
      view.notify({ type: 'removed', id: processRecord().id });
      view.cache.setQueryData(PROCESS_QUERY_KEY, [processRecord({ status: 'stopped' })]);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(screen.queryByText('Chat request')).not.toBeInTheDocument();
      for (const name of ['Sidebar badge', 'Status bar'])
        expect(within(screen.getByLabelText(name)).getByLabelText('Stopped: 0')).toBeVisible();
    });
  });
  it('TC-OWNER-FB3-013 cancel and retry update shared counts immediately', async () => {
    setupCounts('running');
    await screen.findByText('Chat request');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(within(screen.getByLabelText('Sidebar badge')).getByLabelText('Stopped: 1')).toBeVisible();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(within(screen.getByLabelText('Status bar')).getByLabelText('Running: 1')).toBeVisible();
      expect(within(screen.getByLabelText('Sidebar badge')).getByLabelText('Stopped: 1')).toBeVisible();
    });
  });
});
