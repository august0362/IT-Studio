import {
  ErrorCode,
  type ProcessId,
  type ProcessKind,
  type ProcessModule,
  type ProcessRecord,
  type ProcessStatus,
  type Result,
  type RpcMethodMap,
  type RpcNotificationMap,
} from '@itstudio/schemas';
import type { Logger } from 'pino';
import type { IClock } from '../infra/clock.js';
import type { IIdGenerator } from '../infra/id.js';
import type {
  IProcessRepository,
  IProcessTracker,
  ProcessInit,
  ProcessOperation,
  StoredProcess,
} from '../ports/process-tracker.js';
import type { EventBus } from '../rpc/event-bus.js';
import { processGraph } from '../domain/process-graphs.js';
import { redactSecrets } from '../domain/redact.js';
import { isoDateTimeSchema, processIdSchema } from '../validation/brand.js';
import { processRecordSchema } from '../validation/process.js';
import { jsonObjectSchema } from '../validation/common.js';
import { processOperationSchema } from '../validation/process-operation.js';

export interface ProcessRegistryDependencies {
  readonly repository: IProcessRepository;
  readonly events: EventBus<RpcNotificationMap>;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: Logger;
  readonly dispatch: (operation: ProcessOperation, retryOf: ProcessId) => Promise<Result<unknown>>;
  readonly cancelRecovered: (process: ProcessRecord) => Promise<Result<unknown>>;
}

export class ProcessRegistry implements IProcessTracker {
  private readonly deps: ProcessRegistryDependencies;
  private readonly records = new Map<ProcessId, StoredProcess>();
  private readonly cancellations = new Map<ProcessId, NonNullable<ProcessInit['cancel']>>();
  private readonly dirty = new Set<ProcessId>();
  private readonly removed = new Set<ProcessId>();
  private readonly pending = new Map<ProcessId, ReturnType<typeof setTimeout>>();
  private readonly replaying = new Set<ProcessId>();
  private readonly replayIds = new Map<ProcessId, ProcessId>();
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private sequence = 0;
  private readonly restored: readonly ProcessRecord[];
  private stopped = false;

  constructor(dependencies: ProcessRegistryDependencies) {
    this.deps = dependencies;
    for (const stored of dependencies.repository.load()) {
      this.records.set(stored.process.id, stored);
      this.sequence = Math.max(this.sequence, stored.sequence);
    }
    this.restored = [...this.records.values()].map(({ process }) => process);
  }

  async recover(isClarifying: (process: ProcessRecord) => Promise<boolean>): Promise<void> {
    for (const process of this.restored) {
      if (process.status !== 'running' && process.status !== 'waiting') continue;
      if (process.kind === 'code_pipeline' && (await isClarifying(process))) {
        this.status(process.id, 'waiting', 'Waiting for your answers');
        continue;
      }
      this.status(process.id, 'stopped', 'Interrupted by restart');
    }
    this.prune();
    this.flush();
  }

  start(kind: ProcessKind, init: ProcessInit): ProcessId {
    const id = processIdSchema.parse(this.deps.ids.uuid());
    const now = this.now();
    const operation = init.operation === undefined ? undefined : safeOperation(init.operation);
    const process = processRecordSchema.parse({
      id,
      kind,
      title: summary(init.title, 120),
      status: 'running',
      ...processGraph(kind),
      retryable: operation !== undefined,
      createdAt: now,
      updatedAt: now,
      ...(init.projectId === undefined ? {} : { projectId: init.projectId }),
      ...(init.ref === undefined ? {} : { ref: init.ref }),
    });
    this.sequence += 1;
    this.records.set(id, { process, sequence: this.sequence, ...(operation === undefined ? {} : { operation }) });
    if (init.cancel !== undefined) this.cancellations.set(id, init.cancel);
    if (init.retryOf !== undefined) this.replayIds.set(init.retryOf, id);
    this.changed(id);
    this.module(id, process.modules[0]?.id ?? '', { state: 'active', input: summary(init.title) });
    return id;
  }

  module(id: ProcessId | undefined, moduleId: string, patch: Partial<Omit<ProcessModule, 'id' | 'label'>>): void {
    const current = id === undefined ? undefined : this.records.get(id)?.process;
    if (current === undefined || current.status === 'ended' || current.status === 'stopped') return;
    const now = this.now();
    const modules = current.modules.map((module) => {
      if (module.id !== moduleId) return module;
      const unfinished = { ...module };
      Reflect.deleteProperty(unfinished, 'endedAt');
      return {
        ...(patch.state === 'active' || patch.state === 'waiting' ? unfinished : module),
        ...patch,
        ...(patch.state === 'active' && module.startedAt === undefined ? { startedAt: now } : {}),
        ...(patch.state === 'done' || patch.state === 'failed' || patch.state === 'skipped' ? { endedAt: now } : {}),
        ...(patch.input === undefined ? {} : { input: summary(patch.input) }),
        ...(patch.output === undefined ? {} : { output: summary(patch.output) }),
        ...(patch.detail === undefined ? {} : { detail: safeDetail(patch.detail) }),
      };
    });
    if (!modules.some((module) => module.id === moduleId)) return;
    const status = modules.some((module) => module.state === 'failed')
      ? 'stopped'
      : modules.some((module) => module.state === 'active')
        ? 'running'
        : modules.some((module) => module.state === 'waiting')
          ? 'waiting'
          : current.status;
    const next: ProcessRecord = { ...current, modules, status };
    if (status === 'running' && current.status === 'waiting') Reflect.deleteProperty(next, 'statusReason');
    this.put(next);
    if (status === 'stopped') this.cancellations.delete(current.id);
  }

  status(id: ProcessId | undefined, status: ProcessStatus, reason?: string): void {
    const current = id === undefined ? undefined : this.records.get(id)?.process;
    if (current === undefined || current.status === 'ended') return;
    if (current.status === 'stopped') {
      if (status === 'stopped' && reason !== undefined) this.put({ ...current, statusReason: summary(reason) });
      return;
    }
    if (status === 'ended') {
      this.end(id, reason);
      return;
    }
    const rest = { ...current };
    Reflect.deleteProperty(rest, 'statusReason');
    const modules = current.modules.map((module) => {
      if (module.state !== 'active' && module.state !== 'waiting') return module;
      return status === 'stopped'
        ? { ...module, state: 'failed' as const, endedAt: this.now() }
        : { ...module, state: status === 'waiting' ? ('waiting' as const) : ('active' as const) };
    });
    this.put({ ...rest, modules, status, ...(reason === undefined ? {} : { statusReason: summary(reason) }) });
    if (status === 'stopped') this.cancellations.delete(current.id);
  }

  end(id: ProcessId | undefined, result?: string): void {
    const current = id === undefined ? undefined : this.records.get(id)?.process;
    if (current === undefined || current.status === 'ended' || current.status === 'stopped') return;
    const rest = { ...current };
    Reflect.deleteProperty(rest, 'statusReason');
    this.put({
      ...rest,
      status: 'ended',
      endedAt: this.now(),
      ...(result === undefined ? {} : { result: summary(result) }),
      modules: current.modules.map((module) => ({
        ...module,
        state:
          module.state === 'idle'
            ? 'skipped'
            : module.state === 'active' || module.state === 'waiting'
              ? 'done'
              : module.state,
        endedAt: module.endedAt ?? this.now(),
      })),
    });
    this.cancellations.delete(current.id);
    this.prune();
  }

  annotate(id: ProcessId | undefined, patch: Pick<Partial<ProcessRecord>, 'ref' | 'costText'>): void {
    const current = id === undefined ? undefined : this.records.get(id)?.process;
    if (current === undefined || current.status === 'stopped' || current.status === 'ended') return;
    this.put({ ...current, ...patch, ...(patch.costText === undefined ? {} : { costText: summary(patch.costText) }) });
  }

  list(input: RpcMethodMap['process.list']['params']): Result<readonly ProcessRecord[]> {
    const records = [...this.records.values()]
      .sort((a, b) => b.process.updatedAt.localeCompare(a.process.updatedAt) || b.sequence - a.sequence)
      .map((item) => item.process)
      .filter(
        (record) =>
          (input.projectId === undefined || record.projectId === input.projectId) &&
          (input.status === undefined || input.status.includes(record.status)) &&
          (input.kind === undefined || input.kind.includes(record.kind)),
      );
    return { ok: true, value: records.slice(0, input.limit) };
  }

  get(id: ProcessId): Result<ProcessRecord> {
    const record = this.records.get(id);
    return record === undefined
      ? failure('Process was not found.', ErrorCode.NOT_FOUND)
      : { ok: true, value: record.process };
  }

  find(kind: ProcessKind, refId: string): ProcessId | undefined {
    return [...this.records.values()]
      .reverse()
      .find(({ process }) => process.kind === kind && process.ref?.id === refId)?.process.id;
  }

  async cancel(id: ProcessId): Promise<Result<ProcessRecord>> {
    const current = this.get(id);
    if (!current.ok) return current;
    if (current.value.status !== 'running' && current.value.status !== 'waiting')
      return failure('Only active processes can be cancelled.');
    try {
      const cancel = this.cancellations.get(id);
      const result = cancel === undefined ? await this.deps.cancelRecovered(current.value) : await cancel();
      if (!result.ok) return result;
      this.status(id, 'stopped', 'Cancelled');
      return this.get(id);
    } catch (error) {
      this.deps.logger.error({ svc: 'process-registry', id, err: error }, 'Process cancellation failed');
      return failure('Process cancellation failed.', ErrorCode.INTERNAL);
    }
  }

  async retry(id: ProcessId): Promise<Result<ProcessRecord>> {
    const stored = this.records.get(id);
    if (stored === undefined) return failure('Process was not found.', ErrorCode.NOT_FOUND);
    if (stored.process.status !== 'stopped' || stored.operation === undefined || !stored.process.retryable)
      return failure('Only stopped, retryable processes can be retried.');
    if (this.replaying.has(id)) return failure('This process is already being retried.', ErrorCode.CONFLICT);
    this.replaying.add(id);
    try {
      const dispatched = await this.deps.dispatch(stored.operation, id);
      const newId = this.replayIds.get(id);
      if (newId !== undefined) return this.get(newId);
      if (!dispatched.ok) return dispatched;
      return failure('The operation did not create a process.', ErrorCode.INTERNAL);
    } catch (error) {
      this.deps.logger.error({ svc: 'process-registry', id, err: error }, 'Process retry failed');
      return failure('The operation could not be retried.', ErrorCode.INTERNAL);
    } finally {
      this.replaying.delete(id);
      this.replayIds.delete(id);
    }
  }

  dismiss(id: ProcessId): Result<ProcessRecord> {
    return this.dismissStopped(id, true);
  }

  private dismissStopped(id: ProcessId, prune: boolean): Result<ProcessRecord> {
    const current = this.get(id);
    if (!current.ok) return current;
    if (current.value.status !== 'stopped') return failure('Only stopped processes can be dismissed.');
    const ended = { ...current.value, status: 'ended' as const, endedAt: this.now(), updatedAt: this.now() };
    this.put(ended);
    if (prune) this.prune();
    return { ok: true, value: ended };
  }

  delete(id: ProcessId): Result<{ readonly deleted: boolean }> {
    const current = this.records.get(id);
    if (current === undefined) return { ok: true, value: { deleted: false } };
    if (current.process.status !== 'ended' && current.process.status !== 'stopped')
      return failure('Only stopped or ended processes can be deleted.');
    if (current.process.status === 'stopped') {
      const dismissed = this.dismissStopped(id, false);
      if (!dismissed.ok) return dismissed;
    }
    this.remove(id);
    return { ok: true, value: { deleted: true } };
  }

  report(input: RpcMethodMap['process.report']['params']): Result<ProcessRecord> {
    if (input.event === 'closed') {
      const latest = [...this.records.values()]
        .reverse()
        .find(
          ({ process }) =>
            process.kind === 'web_chat' && process.ref?.id === input.linkId && process.projectId === input.projectId,
        )?.process;
      if (latest?.status === 'stopped') return this.dismiss(latest.id);
      if (latest?.status === 'ended') return { ok: true, value: latest };
    }
    let current = [...this.records.values()]
      .reverse()
      .find(
        ({ process }) =>
          process.kind === 'web_chat' &&
          process.ref?.id === input.linkId &&
          process.projectId === input.projectId &&
          (process.status === 'running' || process.status === 'waiting'),
      )?.process;
    if (current === undefined) {
      if (input.event !== 'opened') return failure('Open the web-chat pane before reporting its lifecycle.');
      const id = this.start('web_chat', {
        title: `Web chat: ${input.linkId}`,
        ref: { type: 'webchat_link', id: input.linkId },
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      });
      const found = this.get(id);
      if (!found.ok) return found;
      current = found.value;
    }
    if (input.event === 'opened') {
      this.module(current.id, 'open', { state: 'done' });
      this.module(current.id, 'load', { state: 'active' });
    } else if (input.event === 'loaded') {
      this.module(current.id, 'load', { state: 'done' });
      this.module(current.id, 'active', { state: 'active' });
    } else if (input.event === 'closed') {
      this.module(current.id, 'closed', { state: 'done' });
      this.end(current.id, 'Pane closed');
    } else this.status(current.id, 'stopped', 'Web-chat pane failed to load');
    return this.get(current.id);
  }

  flush(): void {
    if (this.persistTimer !== undefined) clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    if (this.dirty.size === 0 && this.removed.size === 0) return;
    try {
      this.deps.repository.save(
        [...this.dirty].flatMap((id) => {
          const stored = this.records.get(id);
          return stored === undefined ? [] : [stored];
        }),
        [...this.removed],
      );
      this.dirty.clear();
      this.removed.clear();
    } catch (error) {
      this.deps.logger.error({ svc: 'process-registry', err: error }, 'Process persistence failed');
      this.schedulePersistence();
    }
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.flush();
  }

  private now() {
    return isoDateTimeSchema.parse(this.deps.clock.now().toISOString());
  }
  private put(process: ProcessRecord): void {
    const stored = this.records.get(process.id);
    if (stored === undefined) return;
    this.sequence += 1;
    this.records.set(process.id, {
      ...stored,
      sequence: this.sequence,
      process: processRecordSchema.parse({ ...process, updatedAt: this.now() }),
    });
    this.changed(process.id);
  }
  private changed(id: ProcessId): void {
    if (this.stopped) return;
    this.dirty.add(id);
    this.schedulePersistence();
    this.scheduleEvent(id);
  }
  private scheduleEvent(id: ProcessId): void {
    if (this.stopped) return;
    if (this.pending.has(id)) return;
    const timer = setTimeout(() => {
      this.pending.delete(id);
      const stored = this.records.get(id);
      if (stored !== undefined) this.deps.events.publish('process.event', { type: 'upsert', process: stored.process });
      else this.deps.events.publish('process.event', { type: 'removed', id });
    }, 100);
    timer.unref();
    this.pending.set(id, timer);
  }
  private schedulePersistence(): void {
    if (this.stopped) return;
    if (this.persistTimer !== undefined) return;
    this.persistTimer = setTimeout(() => {
      this.flush();
    }, 500);
    this.persistTimer.unref();
  }
  private prune(): void {
    const ended = [...this.records.values()]
      .filter(({ process }) => process.status === 'ended')
      .sort(
        (a, b) =>
          (b.process.endedAt ?? b.process.updatedAt).localeCompare(a.process.endedAt ?? a.process.updatedAt) ||
          b.sequence - a.sequence,
      );
    for (const { process } of ended.slice(20)) this.remove(process.id);
  }
  private remove(id: ProcessId): void {
    this.dirty.delete(id);
    this.records.delete(id);
    this.cancellations.delete(id);
    this.removed.add(id);
    this.schedulePersistence();
    this.scheduleEvent(id);
  }
}

function redact(text: string): string {
  let safe = text;
  for (;;) {
    const next = redactSecrets(safe);
    if (next === safe) return safe;
    safe = next;
  }
}
function summary(text: string, max = 500): string {
  return redact(text).slice(0, max);
}
function safeDetail(detail: NonNullable<ProcessModule['detail']>): NonNullable<ProcessModule['detail']> {
  // Round-trip the existing redactor across every nested string, including property names.
  const parsed: unknown = JSON.parse(redact(JSON.stringify(detail)));
  return jsonObjectSchema.parse(parsed);
}
function safeOperation(operation: ProcessOperation): ProcessOperation {
  const parsed: unknown = JSON.parse(redact(JSON.stringify(operation)));
  return processOperationSchema.parse(parsed);
}
function failure<T = never>(message: string, code: ErrorCode = ErrorCode.VALIDATION): Result<T> {
  return {
    ok: false,
    error: { code, message, retryable: false, remediation: ['Refresh the process list and try again.'] },
  };
}
