import type { PipelineRun, PipelineStage, ProcessModule } from '@itstudio/schemas';

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

/** The sidecar's process modules are authoritative for both viewers. */
export function moduleStatuses(modules: readonly ProcessModule[] = []): Readonly<Record<ModuleId, ModuleStatus>> {
  return Object.fromEntries(
    MODULES.map((id) => [
      id,
      modules.find((module) => module.id === (id === 're-review' ? 're_review' : id))?.state ?? 'idle',
    ]),
  ) as Record<ModuleId, ModuleStatus>;
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
