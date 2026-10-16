import type { PipelineRun, PipelineStage, ProcessModule, ReviewVerdict } from '@itstudio/schemas';
import { processGraph } from './process-graphs.js';

const STAGE_MODULE: Readonly<Partial<Record<PipelineStage, string>>> = {
  specifying: 'spec',
  clarifying: 'clarify',
  coding: 'code',
  reviewing: 'review',
  fixing: 'fix',
  re_reviewing: 're_review',
  writing: 'write',
  validating: 'validate',
  completed: 'done',
};
function reviewSummary(verdict: ReviewVerdict): string {
  const major = verdict.findings.filter((finding) => finding.severity === 'major').length;
  return (
    (verdict.approved ? 'approved' : 'changes requested') +
    ' · ' +
    (major > 0
      ? String(major) + ' major'
      : String(verdict.findings.length) + ' finding' + (verdict.findings.length === 1 ? '' : 's'))
  );
}
/** The process record is the state mapping used by both process and legacy Studio viewers. */
export function pipelineModules(run: PipelineRun, queued = false): readonly ProcessModule[] {
  const modules = processGraph('code_pipeline').modules.map((module) => ({ ...module }));
  const set = (id: string, patch: Partial<ProcessModule>): void => {
    const module = modules.find((item) => item.id === id);
    if (module !== undefined) Object.assign(module, patch);
  };
  if (queued) {
    set('request', { state: 'waiting', input: 'Build request', output: 'Queued behind another pipeline' });
    return modules;
  }
  set('request', { state: 'done', input: 'Build request', output: 'Request received' });
  const questions = run.clarifications;
  const answered = questions?.filter((question) => question.answer !== undefined).length ?? 0;
  const auto = questions?.some((question) => question.answer?.by === 'auto') ?? false;
  if (questions !== undefined)
    set('clarify', {
      state: answered === questions.length ? 'done' : 'waiting',
      input: 'Request + project context',
      output: String(questions.length) + ' questions · ' + String(answered) + ' answered' + (auto ? ' (auto)' : ''),
    });
  else if (run.spec !== undefined) set('clarify', { state: 'skipped' });
  set('spec', { input: 'Request + ' + String(answered) + ' answers' });
  if (run.spec !== undefined) set('spec', { state: 'done', output: run.spec.title });
  const code = run.coderOutputs[0];
  const fix = run.coderOutputs[1];
  set('code', { input: 'Validated task specification' });
  set('review', { input: 'Specification + proposed file changes' });
  set('fix', { input: 'Specification + review findings' });
  set('re_review', { input: 'Specification + revised file changes' });
  if (code !== undefined) set('code', { state: 'done', output: String(code.operations.length) + ' files' });
  if (fix !== undefined) set('fix', { state: 'done', output: String(fix.operations.length) + ' files' });
  for (const [index, verdict] of run.verdicts.entries())
    set(index === 0 ? 'review' : 're_review', { state: 'done', output: reviewSummary(verdict) });
  if (run.fixAttempts === 0) {
    set('fix', { state: 'skipped' });
    set('re_review', { state: 'skipped' });
  }
  const stage = run.failureReport?.stage ?? run.stage;
  const completed = run.stage === 'completed';
  const wrote = stage === 'validating' || completed;
  const fileCount = run.coderOutputs.at(-1)?.operations.length ?? 0;
  set('write', {
    input: String(fileCount) + ' approved file operations',
    ...(wrote ? { state: 'done', output: String(fileCount) + ' files written' } : {}),
  });
  const commands = run.validation ?? [];
  const passed = commands.filter((command) => command.exitCode === 0 && !command.timedOut).length;
  set('validate', {
    input: 'Workspace + validation commands',
    ...(commands.length > 0 || completed
      ? { output: String(passed) + '/' + String(commands.length) + ' commands passed' }
      : {}),
    ...(completed ? { state: 'done' } : {}),
  });
  set('done', {
    input: 'Validated workspace',
    ...(completed ? { state: 'done', output: 'completed · ' + run.cost.usdText } : {}),
  });
  let current = STAGE_MODULE[stage];
  if (stage === 'specifying' && run.spec === undefined && questions === undefined) current = 'clarify';
  if (current !== undefined && !completed) {
    const terminal = ['failed', 'rolled_back', 'cancelled'].includes(run.stage);
    set(current, {
      state: terminal
        ? 'failed'
        : stage === 'clarifying'
          ? answered === questions?.length
            ? 'done'
            : 'waiting'
          : 'active',
    });
  }
  return modules;
}
