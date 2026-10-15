import type { PipelineRun, PipelineStage } from '@itstudio/schemas';

export const MODULES = [
  'request',
  'clarify',
  'spec',
  'code',
  'review',
  'fix',
  're-review',
  'write',
  'validate',
  'done',
] as const;
export type ModuleId = (typeof MODULES)[number];
export type ModuleStatus = 'idle' | 'active' | 'waiting' | 'done' | 'failed' | 'skipped' | 'cancelled';
export const STAGE_MODULE: Readonly<Record<PipelineStage, ModuleId>> = {
  specifying: 'spec',
  clarifying: 'clarify',
  coding: 'code',
  reviewing: 'review',
  fixing: 'fix',
  re_reviewing: 're-review',
  writing: 'write',
  validating: 'validate',
  completed: 'done',
  failed: 'done',
  rolled_back: 'done',
  cancelled: 'done',
};
export const CONNECTIONS: readonly (readonly [ModuleId, ModuleId])[] = [
  ['request', 'clarify'],
  ['request', 'spec'],
  ['clarify', 'spec'],
  ['spec', 'clarify'],
  ['spec', 'code'],
  ['code', 'review'],
  ['review', 'fix'],
  ['fix', 're-review'],
  ['re-review', 'write'],
  ['review', 'write'],
  ['write', 'validate'],
  ['validate', 'done'],
];
export const isFinished = (run: PipelineRun): boolean =>
  ['completed', 'failed', 'rolled_back', 'cancelled'].includes(run.stage);

export function finalModule(run: PipelineRun, enteredStages: readonly PipelineStage[] = []): ModuleId {
  if (!isFinished(run) || run.stage === 'completed') return STAGE_MODULE[run.stage];
  const stage =
    run.failureReport?.stage ??
    [...enteredStages].reverse().find((item) => !['completed', 'failed', 'rolled_back', 'cancelled'].includes(item));
  if (stage !== undefined) return STAGE_MODULE[stage];
  if (run.validation !== undefined) return 'validate';
  if (run.transactionId !== undefined) return 'write';
  if (run.verdicts.length > 1) return 're-review';
  if (run.fixAttempts > 0) return 'fix';
  if (run.verdicts.length > 0) return 'review';
  if (run.coderOutputs.length > 0) return 'code';
  if (run.spec !== undefined) return 'code';
  if (run.clarifications?.some((question) => question.answer === undefined)) return 'clarify';
  return 'spec';
}

export function runPath(run: PipelineRun, enteredStages: readonly PipelineStage[] = []): readonly ModuleId[] {
  const fix =
    run.fixAttempts > 0 ||
    enteredStages.includes('fixing') ||
    enteredStages.includes('re_reviewing') ||
    ['fixing', 're_reviewing'].includes(run.stage);
  const path = MODULES.filter(
    (id) =>
      (id !== 'clarify' || Boolean(run.clarifications?.length) || run.stage === 'clarifying') &&
      (fix || (id !== 'fix' && id !== 're-review')),
  );
  const final = finalModule(run, enteredStages);
  return path.slice(0, path.indexOf(final) + 1);
}

/** Snapshot artifacts establish passed stages; observed events disambiguate terminal runs. */
export function moduleStatuses(
  run: PipelineRun | undefined,
  enteredStages: readonly PipelineStage[],
  finished: boolean,
  queued = false,
): Readonly<Record<ModuleId, ModuleStatus>> {
  const states: Record<ModuleId, ModuleStatus> = {
    request: 'idle',
    clarify: 'idle',
    spec: 'idle',
    code: 'idle',
    review: 'idle',
    fix: 'idle',
    're-review': 'idle',
    write: 'idle',
    validate: 'idle',
    done: 'idle',
  };
  if (run === undefined) return states;
  if (queued && !finished) {
    states.request = 'waiting';
    return states;
  }
  states.request = 'done';
  const path = runPath(run, enteredStages);
  for (const id of path) states[id] = 'done';
  if (!run.clarifications?.length && run.stage !== 'clarifying') states.clarify = 'skipped';
  if (!path.includes('fix')) {
    states.fix = 'skipped';
    states['re-review'] = 'skipped';
  }
  const current = finalModule(run, enteredStages);
  if (!finished) states[current] = run.stage === 'clarifying' ? 'waiting' : 'active';
  else if (run.stage !== 'completed') {
    states[current] = run.stage === 'cancelled' ? 'cancelled' : 'failed';
    states.done = run.stage === 'cancelled' ? 'cancelled' : 'idle';
  }
  // The first PM call can ask questions before it has produced a spec.
  if (run.stage === 'clarifying') states.spec = 'idle';
  if (run.stage === 'specifying' && run.clarifications?.some((q) => q.answer === undefined)) states.clarify = 'idle';
  return states;
}

export const badge = (id: ModuleId, status: ModuleStatus): string =>
  status === 'done'
    ? '✓'
    : status === 'failed'
      ? '✕'
      : status === 'waiting' && id === 'clarify'
        ? '?'
        : status === 'active'
          ? '●'
          : status === 'waiting'
            ? '◷'
            : '—';

export interface Position {
  readonly x: number;
  readonly y: number;
}
export type Layout = Readonly<Partial<Record<ModuleId, Position>>>;
export const LAYOUT_KEY = 'itstudio.pipeline-studio.layout.v1';
export function defaultPosition(id: ModuleId): Position {
  const index = MODULES.indexOf(id);
  return {
    x: index < 5 ? index * 250 : id === 'fix' ? 1180 : id === 're-review' ? 1430 : (index - 2) * 250,
    y: id === 'fix' || id === 're-review' ? 230 : 0,
  };
}
export function readLayout(): Layout {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null) return {};
    const result: Partial<Record<ModuleId, Position>> = {};
    for (const id of MODULES) {
      const value: unknown = Reflect.get(raw, id);
      if (typeof value !== 'object' || value === null) continue;
      const x: unknown = Reflect.get(value, 'x');
      const y: unknown = Reflect.get(value, 'y');
      if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y))
        result[id] = { x, y };
    }
    return result;
  } catch {
    return {};
  }
}
export function writeLayout(layout: Layout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* Optional viewer preference; canvas remains usable without storage. */
  }
}
