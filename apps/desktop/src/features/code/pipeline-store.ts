import {
  PipelineStage,
  type FailureReport,
  type PipelineEvent,
  type PipelineRun,
  type PipelineRunId,
} from '@itstudio/schemas';

const displayStages = [
  PipelineStage.SPECIFYING,
  PipelineStage.CODING,
  PipelineStage.REVIEWING,
  PipelineStage.FIXING,
  PipelineStage.RE_REVIEWING,
  PipelineStage.WRITING,
  PipelineStage.VALIDATING,
] as const;

export type PipelineRunWithHistory = PipelineRun & { readonly enteredStages: readonly PipelineStage[] };

export interface CommandOutputState {
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
}

export interface PipelineEntry {
  readonly run: PipelineRunWithHistory;
  readonly finished: boolean;
  readonly queued: boolean;
  readonly outputs: Readonly<Record<string, CommandOutputState>>;
}

export interface PipelineState {
  readonly entries: Readonly<Record<string, PipelineEntry>>;
  readonly selectedRunId: PipelineRunId | null;
}

export type PipelineAction =
  | { readonly type: 'started'; readonly run: PipelineRun }
  | { readonly type: 'loaded'; readonly run: PipelineRun }
  | { readonly type: 'event'; readonly event: PipelineEvent }
  | { readonly type: 'failure'; readonly report: FailureReport };

export const initialPipelineState: PipelineState = { entries: {}, selectedRunId: null };
const terminal = new Set(['completed', 'rolled_back', 'failed', 'cancelled']);
const MAX_LINES = 2000;

function initialHistory(run: PipelineRun): readonly PipelineStage[] {
  if (run.stage === PipelineStage.COMPLETED) return displayStages;
  if (run.failureReport !== undefined) return [run.failureReport.stage];
  return displayStages.includes(run.stage as (typeof displayStages)[number]) ? [run.stage] : [];
}

export function pipelineReducer(state: PipelineState, action: PipelineAction): PipelineState {
  if (action.type === 'started') {
    const queued = Object.values(state.entries).some(
      (existing) => existing.run.projectId === action.run.projectId && !existing.finished,
    );
    const entry: PipelineEntry = {
      run: { ...action.run, enteredStages: initialHistory(action.run) },
      finished: terminal.has(action.run.stage),
      queued,
      outputs: {},
    };
    return { entries: { ...state.entries, [action.run.id]: entry }, selectedRunId: action.run.id };
  }
  if (action.type === 'loaded') {
    const previous = state.entries[action.run.id];
    return {
      entries: {
        ...state.entries,
        [action.run.id]: {
          ...previous,
          run: {
            ...action.run,
            enteredStages: previous?.run.enteredStages ?? initialHistory(action.run),
          },
          finished: terminal.has(action.run.stage),
          queued: previous?.queued ?? false,
          outputs: previous?.outputs ?? {},
        },
      },
      selectedRunId: action.run.id,
    };
  }
  const runId = action.type === 'failure' ? action.report.runId : action.event.runId;
  if (runId === undefined) return state;
  const entry = state.entries[runId];
  if (entry === undefined || entry.finished) return state;
  if (action.type === 'failure') {
    return {
      ...state,
      entries: {
        ...state.entries,
        [runId]: {
          ...entry,
          run: {
            ...entry.run,
            stage: action.report.rolledBack ? PipelineStage.ROLLED_BACK : PipelineStage.FAILED,
            failureReport: action.report,
            enteredStages: entry.run.enteredStages.includes(action.report.stage)
              ? entry.run.enteredStages
              : [...entry.run.enteredStages, action.report.stage],
          },
          finished: true,
          queued: false,
        },
      },
    };
  }
  const event = action.event;
  if (event.type === 'stage') {
    return {
      ...state,
      entries: {
        ...state.entries,
        [runId]: {
          ...entry,
          run: {
            ...entry.run,
            stage: event.stage,
            enteredStages: entry.run.enteredStages.includes(event.stage)
              ? entry.run.enteredStages
              : [...entry.run.enteredStages, event.stage],
          },
          queued: false,
        },
      },
    };
  }
  if (event.type === 'artifact') return state;
  if (event.type === 'finished') {
    return {
      ...state,
      entries: {
        ...state.entries,
        [runId]: { ...entry, run: { ...entry.run, stage: event.stage }, finished: true },
      },
    };
  }
  const prior = entry.outputs[event.commandRunId] ?? { stdout: '', stderr: '', truncated: false };
  const content = `${prior[event.stream]}${event.chunk}`;
  const lines = content.split('\n');
  const trimmed = lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : lines;
  const outputs = {
    ...entry.outputs,
    [event.commandRunId]: {
      ...prior,
      [event.stream]: trimmed.join('\n'),
      truncated: prior.truncated || lines.length > MAX_LINES,
    },
  };
  return { ...state, entries: { ...state.entries, [runId]: { ...entry, outputs } } };
}
