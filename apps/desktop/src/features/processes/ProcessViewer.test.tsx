import type { ProcessRecord } from '@itstudio/schemas';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { graphDimensions } from '../pipeline-studio/test-support';
import { ProcessViewer } from './ProcessViewer';
import { layoutKey, readProcessLayout, saveProcessLayout } from './process-layout';
import { mountProcesses, processRecord } from './test-support';

const disposers: (() => void)[] = [];
beforeEach(() => {
  graphDimensions();
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 70, height: 20 }),
  });
  void i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
function setup(record = processRecord()) {
  const back = vi.fn();
  const openRef = vi.fn();
  const view = mountProcesses(<ProcessViewer initial={record} onBack={back} onOpenRef={openRef} />, [record]);
  disposers.push(view.dispose);
  return { ...view, back, openRef };
}
describe('PROC-02 process viewer', () => {
  it.each(['chat', 'knowledge_ingest'] as const)(
    'renders a %s graph from modules/edges and shows module I/O, detail, times and ref link',
    async (kind) => {
      const record = processRecord({
        kind,
        modules: [
          { id: 'start', label: kind === 'chat' ? 'Message' : 'Discover', state: 'done' },
          {
            id: 'custom',
            label: kind === 'chat' ? 'Provider' : 'Embed',
            state: 'active',
            startedAt: processRecord().createdAt,
            input: 'Module input',
            output: 'Module output',
            detail: { model: 'model/example', tokens: 12, extra: { count: 3 } },
          },
        ],
        edges: [{ from: 'start', to: 'custom', label: 'Payload' }],
        result: 'Final result',
      });
      const view = setup(record);
      const node = await screen.findByRole('button', { name: `${kind === 'chat' ? 'Provider' : 'Embed'} — Active` });
      expect(view.container.querySelectorAll('.react-flow__node')).toHaveLength(2);
      await waitFor(() => {
        expect(screen.getByText('Payload')).toBeInTheDocument();
      });
      expect(screen.getByText('Final result')).toBeInTheDocument();
      fireEvent.click(node);
      const panel = within(screen.getByRole('dialog'));
      expect(panel.getByText('Module input')).toBeVisible();
      expect(panel.getByText('Module output')).toBeVisible();
      expect(panel.getByText('model/example')).toBeVisible();
      expect(panel.getByText('tokens')).toBeVisible();
      expect(panel.getByText(/Started:/)).toBeVisible();
      fireEvent.click(panel.getByRole('button', { name: 'Open conversation' }));
      expect(view.openRef).toHaveBeenCalledWith(record);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(view.back).toHaveBeenCalledOnce();
    },
  );
  it('animates all rapid module transitions from notifications and replays the graph', async () => {
    const view = setup();
    await screen.findByRole('button', { name: 'Router — Active' });
    await waitFor(() => {
      expect(view.container.querySelector('.react-flow__edge-path')).not.toBeNull();
    });
    act(() => {
      view.notify({
        type: 'upsert',
        process: processRecord({
          modules: processRecord().modules.map((module) => ({
            ...module,
            state: module.id === 'router' ? 'done' : module.id === 'output' ? 'active' : 'done',
          })),
        }),
      });
      view.notify({
        type: 'upsert',
        process: processRecord({
          status: 'ended',
          modules: processRecord().modules.map((module) => ({ ...module, state: 'done' })),
        }),
      });
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('process-packet').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByRole('button', { name: 'Output — Done' })).toBeInTheDocument();
    await waitFor(
      () => {
        expect(screen.queryAllByTestId('process-packet')).toHaveLength(0);
      },
      { timeout: 2000 },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(await screen.findByTestId('process-packet')).toBeInTheDocument();
  });
  it('persists real node dragging per kind, restores it across viewers, and resets layout', async () => {
    const view = setup();
    const node = await screen.findByRole('button', { name: 'Router — Active' });
    const element = node.closest('.react-flow__node');
    if (!element) throw new Error('Missing node');
    await waitFor(() => {
      expect(element).not.toHaveStyle({ visibility: 'hidden' });
    });
    const drag = (target: HTMLElement | Window, type: string, init: MouseEventInit): void => {
      const event = new MouseEvent(type, { bubbles: true, ...init });
      Object.defineProperty(event, 'view', { value: window });
      fireEvent(target, event);
    };
    drag(node, 'mousedown', { button: 0, clientX: 100, clientY: 100 });
    drag(window, 'mousemove', { buttons: 1, clientX: 180, clientY: 140 });
    drag(window, 'mousemove', { buttons: 1, clientX: 220, clientY: 180 });
    drag(window, 'mouseup', { button: 0, clientX: 220, clientY: 180 });
    await waitFor(() => {
      expect(localStorage.getItem(layoutKey('chat'))).toContain('router');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const saved = readProcessLayout('chat');
    expect(saved.router).not.toEqual({ x: 270, y: 0 });
    expect(readProcessLayout('knowledge_ingest')).toEqual({});
    view.unmount();
    const restored = setup();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Router — Active' }).closest('.react-flow__node')).toHaveStyle({
        transform: `translate(${String(saved.router?.x)}px,${String(saved.router?.y)}px)`,
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }));
    await waitFor(() => {
      expect(readProcessLayout('chat')).toEqual({});
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fit view' }));
    expect(restored.container.querySelector('.react-flow__viewport')).not.toBeNull();
  });
  it('handles malformed and denied storage while keeping the canvas usable', async () => {
    localStorage.setItem(layoutKey('chat'), '{bad');
    expect(readProcessLayout('chat')).toEqual({});
    localStorage.setItem(layoutKey('chat'), '{"router":{"x":"bad","y":0}}');
    expect(readProcessLayout('chat')).toEqual({});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    expect(() => {
      saveProcessLayout('chat', {});
    }).not.toThrow();
    setup();
    expect(await screen.findByRole('button', { name: 'Router — Active' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }));
    expect(screen.getByRole('button', { name: 'Router — Active' })).toBeInTheDocument();
  });
  it('shows waiting/failed/idle/skipped badges and handles removal', async () => {
    const record: ProcessRecord = processRecord({
      modules: (['waiting', 'failed', 'idle', 'skipped'] as const).map((state) => ({ id: state, label: state, state })),
      edges: [],
    });
    const view = setup(record);
    for (const [state, badge] of [
      ['waiting', '?'],
      ['failed', '✕'],
      ['idle', '—'],
      ['skipped', '—'],
    ]) {
      const button = await screen.findByRole('button', { name: new RegExp(`^${state ?? ''} —`) });
      expect(button.querySelector('.studio-badge')).toHaveTextContent(badge ?? '');
    }
    act(() => {
      view.notify({ type: 'removed', id: record.id });
    });
    expect(screen.getByRole('status')).toHaveTextContent('This process was removed.');
  });
});
