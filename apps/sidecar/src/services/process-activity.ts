import type { AppError, JsonObject, ProcessId, ProcessKind, ProcessRecord } from '@itstudio/schemas';
import { NO_PROCESS_TRACKER, type IProcessTracker, type ProcessInit } from '../ports/process-tracker.js';
import { PROCESS_MODULES } from '../domain/process-graphs.js';

/** A small per-operation cursor; owning services explicitly advance it at lifecycle boundaries. */
export class ProcessActivity {
  readonly id: ProcessId | undefined;
  private readonly tracker: IProcessTracker;
  private current: string | undefined;
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
      input: input ?? MODULE_INPUTS[moduleId] ?? 'Operation request',
      ...(detail === undefined ? {} : { detail }),
    });
    this.tracker.status(this.id, 'running');
  }
  done(moduleId: string, output?: string, detail?: JsonObject): void {
    const summary = output ?? MODULE_OUTPUTS[moduleId] ?? 'Result available';
    this.tracker.module(this.id, moduleId, {
      state: 'done',
      output: summary,
      ...(detail === undefined ? {} : { detail }),
    });
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

const MODULE_INPUTS: Readonly<Record<string, string>> = {
  context: 'Conversation + knowledge settings',
  router: 'Messages + model requirements',
  provider: 'Model request',
  stream: 'Provider response stream',
  cost: 'Model usage',
  output: 'Response + usage',
  budget: 'Estimated generation cost',
  download: 'Generated image locations',
  store: 'Processed assets',
  gallery: 'Saved images',
  fetch: 'Provider pricing sources',
  extract: 'Provider pricing pages',
  validate: 'Proposed prices',
  save: 'Validated prices',
  parse: 'Discovered documents',
  chunk: 'Parsed document text',
  embed: 'Text chunks',
  done: 'Stored document vectors',
  launch: 'Workspace + editor executable',
  session: 'Editor launch + companion extension',
  result: 'Provider verification response',
};
const MODULE_OUTPUTS: Readonly<Record<string, string>> = {
  context: 'Conversation context prepared',
  router: 'Model selected',
  provider: 'Provider response received',
  stream: 'Response stream received',
  budget: 'Budget check passed',
  download: 'Image downloads available',
  store: 'Assets saved',
  fetch: 'Pricing pages fetched',
  extract: 'Prices extracted',
  validate: 'Price checks passed',
  save: 'Prices saved',
  discover: 'Document paths discovered',
  parse: 'Document text parsed',
  embed: 'Chunk embeddings received',
  locate: 'Editor executable located',
  launch: 'Editor launch accepted',
  request: 'Verification response received',
};
