import type { AppError, JsonObject, ProcessId, ProcessKind, ProcessRecord } from '@itstudio/schemas';
import { NO_PROCESS_TRACKER, type IProcessTracker, type ProcessInit } from '../ports/process-tracker.js';
import { PROCESS_MODULES } from '../domain/process-graphs.js';

/** A small per-operation cursor; owning services explicitly advance it at lifecycle boundaries. */
export class ProcessActivity {
  readonly id: ProcessId | undefined;
  private readonly tracker: IProcessTracker;
  private current: string | undefined;
  private lastOutput: string | undefined;
  constructor(tracker: IProcessTracker, id: ProcessId | undefined, current?: string) {
    this.tracker = tracker;
    this.id = id;
    this.current = current;
  }
  step(moduleId: string, input?: string, detail?: JsonObject): void {
    if (this.current !== undefined && this.current !== moduleId) this.done(this.current);
    this.current = moduleId;
    this.tracker.module(this.id, moduleId, {
      state: 'active',
      input: input ?? this.lastOutput ?? 'Request received',
      ...(detail === undefined ? {} : { detail }),
    });
    this.tracker.status(this.id, 'running');
  }
  done(moduleId: string, output?: string, detail?: JsonObject): void {
    const summary = output ?? `${moduleId.replaceAll('_', ' ')} completed`;
    this.tracker.module(this.id, moduleId, {
      state: 'done',
      output: summary,
      ...(detail === undefined ? {} : { detail }),
    });
    this.lastOutput = summary;
    if (this.current === moduleId) this.current = undefined;
  }
  skip(moduleId: string): void {
    this.tracker.module(this.id, moduleId, { state: 'skipped' });
    if (this.current === moduleId) this.current = undefined;
  }
  detail(moduleId: string, detail: JsonObject): void {
    this.tracker.module(this.id, moduleId, { detail });
  }
  waiting(reason: string): void {
    this.tracker.status(this.id, 'waiting', reason);
  }
  fail(error: AppError | string): void {
    this.tracker.status(this.id, 'stopped', typeof error === 'string' ? error : `${error.code}: ${error.message}`);
  }
  annotate(patch: Pick<Partial<ProcessRecord>, 'ref' | 'costText'>): void {
    this.tracker.annotate(this.id, patch);
  }
  finish(result?: string): void {
    if (this.current !== undefined) this.done(this.current, result);
    this.tracker.end(this.id, result);
  }
}
export function trackProcess(
  tracker: IProcessTracker | undefined,
  kind: ProcessKind,
  init: ProcessInit,
): ProcessActivity {
  const port = tracker ?? NO_PROCESS_TRACKER;
  return new ProcessActivity(port, port.start(kind, init), PROCESS_MODULES[kind][0]);
}
