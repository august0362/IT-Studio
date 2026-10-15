import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { PipelineStudioPage } from './PipelineStudioPage';
import { defaultPosition, LAYOUT_KEY, MODULES } from './studio-model';
import { pipeline, QUESTION, VALIDATED } from './test-fixtures';
import { graphDimensions, mountStudio } from './test-support';

const studioStyles = readFileSync(
  resolve(process.cwd(), 'apps/desktop/src/features/pipeline-studio/studio.css'),
  'utf8',
);

vi.mock('../code/monaco-setup', () => ({}));
vi.mock('@monaco-editor/react', () => ({ DiffEditor: () => <div>Diff editor</div> }));
const disposers: (() => void)[] = [];
beforeAll(async () => {
  await import('./index');
}, 20000);
beforeEach(() => {
  graphDimensions();
  void i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
function setup(runs = [pipeline()], noProject = false) {
  const back = vi.fn();
  const mounted = mountStudio(
    <>
      <style>{studioStyles}</style>
      <PipelineStudioPage projectId={noProject ? null : pipeline().projectId} projectName="Project One" onBack={back} />
    </>,
    runs,
  );
  disposers.push(mounted.dispose);
  return { ...mounted, back };
}
const node = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name} —`) });
describe('PSTUDIO-02 page', () => {
  it('has a black fullscreen root and all module names, with no canvas detail panels', async () => {
    const { container, calls } = setup();
    await screen.findByRole('button', { name: 'Spec — Active' });
    expect(screen.getByRole('region', { name: 'Pipeline Studio' })).toHaveClass('fixed', 'inset-0', 'overflow-hidden');
    expect(screen.getByRole('region', { name: 'Pipeline Studio' })).toHaveStyle({ background: 'black' });
    for (const name of [
      'Request',
      'Clarify',
      'Spec',
      'Code',
      'Review',
      'Fix',
      'Re-review',
      'Write',
      'Validate',
      'Done',
    ])
      expect(node(name)).toBeInTheDocument();
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(10);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls('pipeline.list')[0]).toContain('"limit":20');
  });
  it.each(['Clarify', 'Validate'])(
    'QA round 1: %s panel stays fixed and opaque, with scroll-free focus',
    async (name) => {
      setup([pipeline({ ...VALIDATED, stage: 'clarifying', clarifications: [QUESTION] })]);
      await screen.findByRole('button', { name: 'Clarify — Waiting' });
      const module = node(name);
      module.focus();
      const focus = vi.spyOn(HTMLElement.prototype, 'focus');
      fireEvent.click(module);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveClass('studio-panel-fixed');
      expect(dialog).toHaveStyle({
        position: 'fixed',
        top: '0px',
        right: '0px',
        height: '100%',
        background: 'rgb(5, 7, 10)',
        opacity: '1',
      });
      expect(dialog).toHaveStyle({ animation: 'studio-slide 260ms ease-out forwards' });
      expect(screen.getByRole('region', { name: 'Pipeline Studio' })).toHaveStyle({ overflow: 'hidden' });
      expect(screen.getByRole('button', { name: 'Close module details' })).toHaveFocus();
      expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(module).toHaveFocus();
      expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    },
  );
  it.each(['completed', 'rolled_back'] as const)(
    'QA round 1: %s has opaque solid badges and glowing passed edges',
    async (stage) => {
      const { container } = setup([pipeline({ ...VALIDATED, stage })]);
      const validate = await screen.findByRole('button', {
        name: `Validate — ${stage === 'completed' ? 'Done' : 'Failed / rolled back'}`,
      });
      const badge = validate.querySelector('.studio-badge');
      expect(badge).toHaveTextContent(stage === 'completed' ? '✓' : '✕');
      expect(badge).toHaveStyle({
        width: '22px',
        height: '22px',
        opacity: '1',
        color: 'rgb(5, 7, 10)',
        fontSize: '13px',
        fontWeight: '800',
      });
      expect(badge).toHaveStyle({
        background: stage === 'completed' ? 'rgb(120, 237, 177)' : 'var(--studio-glow)',
        animation: 'studio-pop 220ms ease-out both',
      });
      expect(validate).toHaveStyle({ width: '210px', minHeight: '88px' });
      expect(validate.querySelector('.studio-module-name')).toHaveStyle({ fontSize: '15px' });
      expect(validate.querySelector('.studio-caption')).toHaveStyle({ fontSize: '12px' });
      const passed = container.querySelector('[data-testid="rf__edge-spec-code"] .react-flow__edge-path');
      expect(passed).toHaveStyle({
        stroke: 'var(--studio-edge-done)',
        filter: 'drop-shadow(0 0 5px var(--studio-edge-done))',
      });
    },
  );
  it('QA round 2: completed main-path badges including Done show solid green ✓ without waiting for animation', async () => {
    const command = VALIDATED.validation?.[0];
    if (command === undefined) throw new Error('Validation fixture missing');
    const { container } = setup([
      pipeline({
        ...VALIDATED,
        clarifications: [{ ...QUESTION, answer: { by: 'auto', optionId: 'local', at: VALIDATED.startedAt } }],
        spec: {
          title: 'Completed specification',
          userStory: 'Build a sample',
          acceptanceCriteria: ['Pass validation'],
          allowedPaths: [],
          contracts: '',
          constraints: [],
          testPlan: ['Run validation'],
          outOfScope: [],
        },
        coderOutputs: [{ summary: 'Implemented sample', assumptions: [], operations: [] }],
        verdicts: [{ approved: true, summary: 'Approved', findings: [] }],
        // @ts-expect-error Readable fixture stands in for a branded transaction identifier.
        transactionId: 'transaction-completed',
        validation: [
          command,
          {
            ...command,
            // @ts-expect-error Readable fixture stands in for a branded command identifier.
            id: 'command-2',
          },
          {
            ...command,
            // @ts-expect-error Readable fixture stands in for a branded command identifier.
            id: 'command-3',
          },
        ],
      }),
    ]);
    await screen.findByRole('button', { name: 'Done — Done' });
    for (const id of MODULES.filter((module) => module !== 'fix' && module !== 're-review')) {
      const module = node(i18n.t(`pipelineStudio.modules.${id}`));
      const card = module.closest<HTMLElement>('.studio-node');
      expect(card).toHaveClass('studio-done');
      // A run/card palette override must not erase the badge's solid state colour.
      card?.style.setProperty('--studio-glow', 'rgb(5, 7, 10)');
      const badge = module.querySelector<HTMLElement>('.studio-badge');
      expect(badge).toHaveClass('studio-done');
      expect(badge?.textContent).toBe('✓');
      expect(badge).toHaveStyle({ background: 'rgb(120, 237, 177)', color: 'rgb(5, 7, 10)', opacity: '1' });
    }
    expect(node('Fix').closest('.studio-node')).toHaveClass('studio-skipped');
    expect(node('Re-review').closest('.studio-node')).toHaveClass('studio-skipped');
    const styles = container.querySelector('style')?.sheet;
    const pop = Array.from(styles?.cssRules ?? []).find((rule) => rule.cssText.startsWith('@keyframes studio-pop'));
    expect(pop).toBeDefined();
    // A paused or unstarted pop must never make the checkmark transparent.
    expect(pop?.cssText).not.toMatch(/opacity:\s*0(?:;|\s|})/);
  });
  it.each(['failed', 'rolled_back'] as const)(
    'QA round 2: %s leaves Done grey with — and only Validate shows ✕',
    async (stage) => {
      setup([pipeline({ ...VALIDATED, stage })]);
      await screen.findByRole('button', { name: 'Validate — Failed / rolled back' });
      const done = node('Done');
      expect(done.closest('.studio-node')).toHaveClass('studio-idle');
      expect(done.querySelector('.studio-badge')).toHaveTextContent('—');
      expect(screen.getAllByText('✕')).toHaveLength(1);
    },
  );
  it.each([
    [1600, 700],
    [1280, 600],
  ])('QA round 1: initial view and Fit view contain every module at canvas %s × %s', async (width, height) => {
    graphDimensions(width, height);
    const view = setup([VALIDATED]);
    await screen.findByRole('button', { name: 'Done — Done' });
    const assertFit = (): void => {
      const viewport = view.container.querySelector<HTMLElement>('.react-flow__viewport');
      const match = viewport?.style.transform.match(/translate\(([-\d.]+)px,([-\d.]+)px\) scale\(([\d.]+)\)/);
      if (match === undefined || match === null) throw new Error('Viewport transform missing');
      const x = Number(match[1]);
      const y = Number(match[2]);
      const zoom = Number(match[3]);
      expect(zoom).toBeGreaterThan(0.4);
      expect(zoom).toBeLessThanOrEqual(1.2);
      for (const id of MODULES) {
        const position = defaultPosition(id);
        expect(x + position.x * zoom).toBeGreaterThanOrEqual(0);
        expect(x + (position.x + 210) * zoom).toBeLessThanOrEqual(width);
        expect(y + position.y * zoom).toBeGreaterThanOrEqual(0);
        expect(y + (position.y + 88) * zoom).toBeLessThanOrEqual(height);
      }
    };
    await waitFor(assertFit);
    fireEvent.click(screen.getByRole('button', { name: 'Fit view' }));
    await waitFor(assertFit);
  });
  it('pipeline.event refetches the run and changes the badge; failureReport also refetches', async () => {
    const view = setup();
    await screen.findByRole('button', { name: 'Spec — Active' });
    view.setRuns([pipeline({ stage: 'coding' })]);
    act(() => {
      view.notify({ type: 'stage', runId: pipeline().id, stage: 'coding' });
    });
    expect(await screen.findByRole('button', { name: 'Code — Active' })).toBeInTheDocument();
    expect(node('Spec')).toHaveTextContent('✓');
    const active = view.container.querySelector('[data-testid="rf__edge-spec-code"] .react-flow__edge-path');
    expect(active).toHaveStyle({ stroke: 'var(--studio-edge-active)', strokeDasharray: '10 6' });
    const before = view.calls('pipeline.get').length;
    const report = {
      runId: pipeline().id,
      stage: 'coding',
      rolledBack: false,
      error: { code: 'INTERNAL', message: 'Coder failed', retryable: true },
      nextSteps: ['Retry'],
      logExcerpt: 'Model error',
    } as const;
    view.setRuns([pipeline({ stage: 'failed', failureReport: report })]);
    act(() => {
      view.transport.receive(JSON.stringify({ jsonrpc: '2.0', method: 'pipeline.failureReport', params: report }));
    });
    await waitFor(() => {
      expect(view.calls('pipeline.get').length).toBeGreaterThan(before);
    });
    expect(await screen.findByRole('button', { name: 'Code — Failed / rolled back' })).toHaveTextContent('✕');
    fireEvent.click(node('Done'));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Coder failed');
  });
  it('opens waiting Clarify, shows recommendations, and submits pipeline.answerClarifications', async () => {
    const view = setup([pipeline({ stage: 'clarifying', clarifications: [QUESTION] })]);
    const clarify = await screen.findByRole('button', { name: 'Clarify — Waiting' });
    const question = clarify.querySelector('.studio-question');
    if (question === null) throw new Error('Clarify badge missing');
    expect(window.getComputedStyle(question).animation).toContain('studio-waiting-pulse');
    expect(question).toHaveTextContent('?');
    fireEvent.click(clarify);
    expect(screen.getByRole('dialog')).toHaveTextContent('Works offline.');
    fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
    await waitFor(() => {
      expect(view.calls('pipeline.answerClarifications')[0]).toContain('"optionId":"local"');
    });
    expect(await screen.findByText('Your answer')).toBeInTheDocument();
    expect(node('Clarify')).toHaveTextContent('✓');
  });
  it('answered Clarify remains read-only with Auto and User tags', async () => {
    const auto = { ...QUESTION, answer: { by: 'auto' as const, at: pipeline().startedAt, optionId: 'local' } };
    const user = {
      ...QUESTION,
      id: 'other',
      question: 'Other decision?',
      answer: { by: 'user' as const, at: pipeline().startedAt, optionId: 'cloud' },
    };
    setup([pipeline({ stage: 'coding', clarifications: [auto, user] })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Clarify — Done' }));
    expect(screen.getByText('Your answer')).toBeVisible();
    expect(screen.getByRole('dialog')).toHaveTextContent(i18n.t('code.autoChosen'));
    expect(screen.queryByRole('button', { name: 'Submit answers' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio').every((radio) => radio.hasAttribute('disabled'))).toBe(true);
  });
  it('module panels expose request, spec, code, review, fix, write, and final result information', async () => {
    const run = pipeline({
      ...VALIDATED,
      fixAttempts: 1,
      spec: {
        title: 'Tool specification',
        userStory: 'Spec story',
        acceptanceCriteria: ['Works locally'],
        allowedPaths: [],
        contracts: 'interface Tool {}',
        constraints: ['Offline'],
        testPlan: ['Run tests'],
        outOfScope: ['Cloud deployment'],
      },
      coderOutputs: [
        {
          summary: 'Initial implementation',
          assumptions: ['Local storage available'],
          operations: [
            {
              kind: 'create',
              // @ts-expect-error Readable fixture stands in for a branded workspace path.
              path: 'tool.ts',
              content: 'export const tool = 1;',
            },
          ],
        },
        { summary: 'Fixed implementation', assumptions: ['Review resolved'], operations: [] },
      ],
      verdicts: [
        {
          approved: false,
          summary: 'Please fix this',
          findings: [
            {
              severity: 'major',
              category: 'correctness',
              // @ts-expect-error Readable fixture stands in for a branded workspace path.
              path: 'tool.ts',
              line: 1,
              message: 'Missing check',
              suggestedFix: 'Add a guard',
            },
          ],
        },
        { approved: true, summary: 'All good after fixing', findings: [] },
      ],
      // @ts-expect-error Readable fixture stands in for a branded transaction identifier.
      transactionId: 'transaction-1',
    });
    setup([run]);
    await screen.findByRole('button', { name: 'Done — Done' }, { timeout: 10000 });
    for (const [name, expected] of [
      ['Request', 'Build a sample'],
      ['Spec', 'Cloud deployment'],
      ['Code', 'Local storage available'],
      ['Review', 'Missing check'],
      ['Fix', 'Fixed implementation'],
      ['Re-review', 'All good after fixing'],
      ['Write', 'transaction-1'],
      ['Done', 'Duration: 0 seconds'],
    ]) {
      if (name === undefined || expected === undefined) throw new Error('Incomplete panel expectation');
      fireEvent.click(node(name));
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent(expected);
      expect(dialog).toHaveTextContent('Incoming modules');
      expect(dialog).toHaveTextContent('Outgoing modules');
      expect(dialog).toHaveTextContent('Run started');
      fireEvent.click(screen.getByRole('button', { name: 'Close module details' }));
    }
    fireEvent.click(node('Done'));
    expect(within(screen.getByRole('dialog')).getByLabelText('USD $0.00; VND 0 ₫')).toBeInTheDocument();
  }, 15000);
  it('Vietnamese labels cover navigation, controls, and module states', async () => {
    await i18n.changeLanguage('vi');
    setup();
    expect(await screen.findByRole('button', { name: 'Đặc tả — Đang chạy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vừa khung nhìn' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '← Quay lại' })).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
  it('Validate shows saved command output and live command chunks', async () => {
    const view = setup([{ ...VALIDATED, stage: 'validating' }]);
    fireEvent.click(await screen.findByRole('button', { name: 'Validate — Active' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('3 tests passed');
    act(() => {
      view.notify({
        type: 'command_output',
        runId: VALIDATED.id,
        // @ts-expect-error Readable fixture stands in for a branded command identifier.
        commandRunId: 'command-live',
        stream: 'stdout',
        chunk: 'Live validation output',
      });
    });
    expect(await screen.findByText('Live validation output')).toBeVisible();
  });
  it('Escape closes the panel, restores focus, then returns Back; canvas click and × close too', async () => {
    const view = setup();
    const request = await screen.findByRole('button', { name: 'Request — Done' });
    request.focus();
    fireEvent.click(request);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close module details' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(view.back).not.toHaveBeenCalled();
    expect(request).toHaveFocus();
    fireEvent.click(request);
    fireEvent.click(screen.getByRole('button', { name: 'Close module details' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(request);
    const pane = view.container.querySelector('.react-flow__pane');
    if (pane === null) throw new Error('Canvas missing');
    fireEvent.click(pane);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(view.back).toHaveBeenCalledOnce();
  });
  it('New request calls pipeline.start, selects the new run and follows runs started elsewhere', async () => {
    const view = setup([VALIDATED]);
    await screen.findByRole('button', { name: 'Done — Done' });
    fireEvent.change(screen.getByLabelText('New request'), { target: { value: 'Make a tool' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    await waitFor(() => {
      expect(view.calls('pipeline.start')[0]).toContain('"prompt":"Make a tool"');
    });
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Run' })).toHaveValue('run-new');
    });
    const external = pipeline({
      // @ts-expect-error Readable fixture stands in for a branded run identifier.
      id: 'external',
      // @ts-expect-error ISO fixture stands in for a branded timestamp.
      startedAt: '2026-01-03T00:00:00.000Z',
    });
    view.setRuns([external, VALIDATED]);
    act(() => {
      view.notify({ type: 'stage', runId: external.id, stage: 'specifying' });
    });
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Run' })).toHaveValue('external');
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Run' }), { target: { value: VALIDATED.id } });
    expect(await screen.findByRole('button', { name: 'Done — Done' })).toBeInTheDocument();
  });
  it('no project disables starting with a hint; no runs keeps only Request and the input', async () => {
    const view = setup([], true);
    expect(screen.getByLabelText('New request')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Open a project');
    expect(view.calls('pipeline.list')).toHaveLength(0);
    view.unmount();
    const empty = setup([]);
    await screen.findByText('No runs yet. Start a request above.');
    expect(node('Request')).toBeInTheDocument();
    expect(empty.container.querySelectorAll('.react-flow__node')).toHaveLength(1);
    expect(screen.getByLabelText('New request')).toBeEnabled();
  });
  it('shows RPC errors and keeps the request editable', async () => {
    const view = setup();
    await screen.findByRole('button', { name: 'Spec — Active' });
    view.fail('pipeline.start');
    fireEvent.change(screen.getByLabelText('New request'), { target: { value: 'Retry me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Studio RPC failed');
    expect(screen.getByLabelText('New request')).toBeEnabled();
  });
  it.each([false, true])('layout persistence and Reset work with throwing storage=%s', async (throwing) => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ code: { x: 12, y: 34 } }));
    if (throwing) {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Denied');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Denied');
      });
    }
    const view = setup();
    await screen.findByRole('button', { name: 'Code — Idle' });
    const code = node('Code').closest('.react-flow__node');
    expect(code).toHaveStyle({ transform: `translate(${throwing ? '750px,0px' : '12px,34px'})` });
    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }));
    const position = defaultPosition('code');
    await waitFor(() => {
      expect(node('Code').closest('.react-flow__node')).toHaveStyle({
        transform: `translate(${String(position.x)}px,${String(position.y)}px)`,
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fit view' }));
    if (!throwing) expect(localStorage.getItem(LAYOUT_KEY)).toBe('{}');
    expect(within(view.container).getByRole('button', { name: 'Request — Done' })).toBeInTheDocument();
  });
  it('dragging a node persists its position without opening the detail panel', async () => {
    const view = setup();
    const code = await screen.findByRole('button', { name: 'Code — Idle' });
    const element = code.closest('.react-flow__node');
    if (element === null) throw new Error('Code node missing');
    await waitFor(() => {
      expect(element).not.toHaveStyle({ visibility: 'hidden' });
    });
    const dragEvent = (target: HTMLElement | Window, type: string, init: MouseEventInit): void => {
      const event = new MouseEvent(type, { bubbles: true, ...init });
      // jsdom's Window proxy cannot pass its UIEvent constructor's view conversion.
      Object.defineProperty(event, 'view', { value: window });
      fireEvent(target, event);
    };
    dragEvent(code, 'mousedown', { button: 0, clientX: 100, clientY: 100 });
    dragEvent(window, 'mousemove', { buttons: 1, clientX: 180, clientY: 140 });
    dragEvent(window, 'mousemove', { buttons: 1, clientX: 220, clientY: 180 });
    dragEvent(window, 'mouseup', { button: 0, clientX: 220, clientY: 180 });
    await waitFor(() => {
      expect(localStorage.getItem(LAYOUT_KEY)).toContain('code');
    });
    expect(element).not.toHaveStyle({ transform: 'translate(750px,0px)' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.unmount();
    setup();
    await screen.findByRole('button', { name: 'Code — Idle' });
    expect(node('Code').closest('.react-flow__node')).not.toHaveStyle({ transform: 'translate(750px,0px)' });
  });
});
