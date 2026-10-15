import type { CommandRun } from '@itstudio/schemas';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { StudioPanel } from './StudioPanel';
import { pipeline, VALIDATED } from './test-fixtures';

vi.mock('../code/monaco-setup', () => ({}));
vi.mock('@monaco-editor/react', () => ({ DiffEditor: () => null }));

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(cleanup);

function command(overrides: Partial<CommandRun> = {}): CommandRun {
  const saved = VALIDATED.validation?.[0];
  if (saved === undefined) throw new Error('Missing validation fixture');
  return { ...saved, ...overrides };
}
function validate(saved: CommandRun): HTMLElement {
  render(
    <StudioPanel
      module="validate"
      status="done"
      run={pipeline({ validation: [saved] })}
      outputs={{}}
      busy={false}
      onAnswer={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return screen.getByRole('dialog');
}

describe('PSTUDIO-02 QA round 3 panel readability', () => {
  it.each([
    ['en', false],
    ['en', true],
    ['vi', false],
    ['vi', true],
  ] as const)(
    '%s: timeout chip appears only for timedOut=%s; empty diagnostics stay hidden',
    async (locale, timedOut) => {
      await i18n.changeLanguage(locale);
      const dialog = validate(command({ timedOut }));
      const chip = within(dialog).queryByText(i18n.t('pipelineStudio.timedOut'));
      if (timedOut) expect(chip).toHaveClass('studio-timeout-chip');
      else expect(chip).not.toBeInTheDocument();
      expect(within(dialog).queryByText(i18n.t('pipelineStudio.diagnostics'))).not.toBeInTheDocument();
      expect(within(dialog).queryByText(i18n.t('pipelineStudio.testResults'))).not.toBeInTheDocument();
      expect(dialog).not.toHaveTextContent(/\b(?:true|false)\b|"diagnostics"|"tests"/);
      expect(dialog).toHaveTextContent(i18n.t('pipelineStudio.commandResult', { exit: 0, duration: 100, limit: 1000 }));
    },
  );

  it.each(['en', 'vi'])('%s: diagnostics and test failures are readable lists', async (locale) => {
    await i18n.changeLanguage(locale);
    const dialog = validate(
      command({
        exitCode: 1,
        diagnostics: [
          {
            source: 'tsc',
            severity: 'error',
            // @ts-expect-error Readable fixture stands in for a branded workspace path.
            path: 'src/tool.ts',
            line: 12,
            column: 4,
            message: 'A guard is required',
            code: 'TS2322',
          },
        ],
        tests: {
          passed: 2,
          failed: 2,
          skipped: 1,
          failures: [
            {
              name: 'handles missing data',
              message: 'Expected a fallback',
              // @ts-expect-error Readable fixture stands in for a branded workspace path.
              path: 'src/tool.test.ts',
            },
            { name: 'handles empty data', message: 'Expected an empty result' },
          ],
        },
      }),
    );
    const diagnostics = within(dialog).getByRole('list', { name: i18n.t('pipelineStudio.diagnostics') });
    expect(within(diagnostics).getAllByRole('listitem')).toHaveLength(1);
    expect(diagnostics).toHaveTextContent('src/tool.ts:12:4 — A guard is required');
    expect(diagnostics).toHaveTextContent(`${i18n.t('pipelineStudio.diagnosticSeverity.error')} · tsc · TS2322`);
    expect(dialog).toHaveTextContent(i18n.t('pipelineStudio.testSummary', { passed: 2, failed: 2, skipped: 1 }));
    const failures = within(dialog).getByRole('list', { name: i18n.t('pipelineStudio.testFailures') });
    expect(within(failures).getAllByRole('listitem')).toHaveLength(2);
    expect(failures).toHaveTextContent('src/tool.test.ts — handles missing data — Expected a fallback');
    expect(failures).toHaveTextContent('handles empty data — Expected an empty result');
    expect(dialog).not.toHaveTextContent(/"diagnostics"|"failures"|"passed"/);
  });

  it('shows passing test counts without an empty failure list', () => {
    const dialog = validate(command({ tests: { passed: 3, failed: 0, skipped: 0, failures: [] } }));
    expect(dialog).toHaveTextContent('Passed: 3 · Failed: 0 · Skipped: 0');
    expect(within(dialog).queryByRole('list')).not.toBeInTheDocument();
  });

  it('Request lists role model ladders in order and labels empty assignments without JSON', () => {
    render(
      <StudioPanel
        module="request"
        status="done"
        run={pipeline({ roleAssignment: { pm: ['openai/primary', 'anthropic/fallback'], coder: [], reviewer: [] } })}
        outputs={{}}
        busy={false}
        onAnswer={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    const models = within(dialog).getByRole('list', { name: 'Product manager' });
    expect(
      within(models)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['openai/primary', 'anthropic/fallback']);
    expect(within(dialog).getAllByText('No models assigned.')).toHaveLength(2);
    expect(dialog.querySelector('pre')).toBeNull();
    expect(dialog).not.toHaveTextContent(/"pm"|"coder"|"reviewer"/);
  });
});
