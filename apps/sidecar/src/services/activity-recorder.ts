import {
  WorkflowModuleId,
  type ActivityEvent,
  type ActivityKind,
  type ConversationId,
  type MoneyDisplay,
  type ProjectId,
  type RpcNotificationMap,
  type WorkflowGraph,
  type WorkflowModuleId as ModuleId,
} from '@itstudio/schemas';
import type { IClock } from '../infra/clock.js';
import type { IIdGenerator } from '../infra/id.js';
import { redactLogLine } from '../domain/redact.js';
import { workflowTopology } from '../domain/workflow-topology.js';
import { activityEventIdSchema, isoDateTimeSchema } from '../validation/brand.js';
import type { ActivityRepository } from '../infra/sqlite/activity-repository.js';
import type { EventBus } from '../rpc/event-bus.js';
import type { SettingsService } from './settings-service.js';
import type { WorkflowInternalEvent, WorkflowInternalEventBus } from './workflow-internal-events.js';

type SourceName =
  | 'router.event'
  | 'chat.delta'
  | 'chat.completed'
  | 'chat.failed'
  | 'pipeline.event'
  | 'pipeline.failureReport'
  | 'rag.progress'
  | 'ledger.entry'
  | 'budget.alert'
  | 'pricing.updated'
  | 'vscode.status'
  | 'vscode.diagnostics';
type SourceEvent = { [N in SourceName]: { readonly name: N; readonly payload: RpcNotificationMap[N] } }[SourceName];
type ActivityMapping = Omit<ActivityEvent, 'id' | 'ts'>;
interface RequestCorrelation {
  readonly projectId: ProjectId;
  readonly conversationId: ConversationId;
}
const MAX_CORRELATIONS = 5000;
const MAX_UNCORRELATED_EVENTS = 1000;
const PIPELINE_MODULES: ReadonlySet<ModuleId> = new Set([
  WorkflowModuleId.PIPELINE_PM,
  WorkflowModuleId.PIPELINE_CODER,
  WorkflowModuleId.PIPELINE_REVIEWER,
  WorkflowModuleId.WORKER,
]);

export function mapWorkflowEvent(
  source: SourceEvent,
  projectId: ProjectId | null,
  refs: ActivityEvent['refs'] = {},
): ActivityMapping {
  const edge = (edgeId: string): string => edgeId;
  switch (source.name) {
    case 'router.event': {
      const event = source.payload;
      const kind: ActivityKind =
        event.type === 'state' &&
        (event.state === 'succeeded' || event.state === 'failed' || event.state === 'cancelled')
          ? event.state === 'succeeded'
            ? 'completed'
            : event.state === 'failed'
              ? 'failed'
              : 'info'
          : event.type === 'attempt_failed'
            ? 'progress'
            : event.type === 'state' && event.state === 'dispatching'
              ? 'started'
              : event.type === 'state' && event.state === 'streaming'
                ? 'started'
                : 'progress';
      const moduleId =
        event.type === 'state' && event.state === 'streaming' ? WorkflowModuleId.PROVIDERS : WorkflowModuleId.ROUTER;
      return {
        projectId,
        moduleId,
        edgeId: edge('router-providers'),
        kind,
        summary:
          event.type === 'state'
            ? `Router ${event.state === 'succeeded' ? 'completed' : event.state}${event.modelKey === undefined ? '' : ` on ${event.modelKey}`}`
            : event.type === 'fallback'
              ? `Fallback ${event.from} → ${event.to}`
              : event.type === 'attempt_failed'
                ? `Attempt failed for ${event.attempt.modelKey}`
                : `Circuit ${event.status} for ${event.modelKey}`,
        refs: { ...refs, ...(event.type === 'circuit' ? {} : { requestId: event.requestId }) },
      };
    }
    case 'chat.delta':
      return {
        projectId,
        moduleId: WorkflowModuleId.CHAT,
        edgeId: 'chat-router',
        kind: 'progress',
        summary: 'Assistant response streamed',
        refs: { ...refs, requestId: source.payload.requestId },
      };
    case 'chat.completed':
      return {
        projectId,
        moduleId: WorkflowModuleId.CHAT,
        edgeId: 'chat-router',
        kind: 'completed',
        summary: 'Assistant response completed',
        refs: { ...refs, requestId: source.payload.requestId, conversationId: source.payload.message.conversationId },
        cost: source.payload.cost,
      };
    case 'chat.failed':
      return {
        projectId,
        moduleId: WorkflowModuleId.CHAT,
        edgeId: 'chat-router',
        kind: 'failed',
        summary: `Chat failed: ${redactLogLine(source.payload.error.code)}`,
        refs: { ...refs, requestId: source.payload.requestId },
      };
    case 'pipeline.event': {
      const event = source.payload;
      const moduleId: ModuleId =
        event.type === 'stage'
          ? event.stage === 'specifying'
            ? WorkflowModuleId.PIPELINE_PM
            : event.stage === 'coding' || event.stage === 'fixing'
              ? WorkflowModuleId.PIPELINE_CODER
              : event.stage === 'reviewing' || event.stage === 're_reviewing'
                ? WorkflowModuleId.PIPELINE_REVIEWER
                : event.stage === 'writing' || event.stage === 'validating'
                  ? WorkflowModuleId.WORKER
                  : WorkflowModuleId.PIPELINE_PM
          : WorkflowModuleId.WORKER;
      const kind: ActivityKind =
        event.type === 'finished'
          ? event.stage === 'completed'
            ? 'completed'
            : event.stage === 'failed' || event.stage === 'rolled_back'
              ? 'failed'
              : 'info'
          : event.type === 'stage'
            ? 'started'
            : 'progress';
      const summary =
        event.type === 'stage'
          ? `Pipeline stage: ${event.stage}`
          : event.type === 'artifact'
            ? `Produced ${event.kind} artifact ${String(event.index + 1)}`
            : event.type === 'finished'
              ? `Pipeline ${event.stage}`
              : `Validation output (${event.stream})`;
      return {
        projectId,
        moduleId,
        edgeId: 'pm-coder',
        kind,
        summary,
        refs: {
          ...refs,
          pipelineRunId: event.runId,
          ...(event.type === 'command_output' ? { commandRunId: event.commandRunId } : {}),
        },
      };
    }
    case 'pipeline.failureReport':
      return {
        projectId,
        moduleId: WorkflowModuleId.WORKER,
        edgeId: 'worker-files',
        kind: 'failed',
        summary: `Pipeline failed: ${redactLogLine(source.payload.error.code)}`,
        refs: { ...refs, ...(source.payload.runId === undefined ? {} : { pipelineRunId: source.payload.runId }) },
      };
    case 'rag.progress': {
      const job = source.payload;
      const terminal = job.status === 'indexed' || job.status === 'failed' || job.status === 'skipped_unchanged';
      return {
        projectId: job.projectId,
        moduleId: WorkflowModuleId.RAG_INGEST,
        edgeId: 'knowledge-ingest',
        kind:
          job.status === 'failed' ? 'failed' : terminal ? 'completed' : job.processedFiles > 0 ? 'progress' : 'started',
        summary: `Ingest ${job.status}: ${String(job.processedFiles)}/${String(job.totalFiles)} files`,
        refs: { ...refs, ingestJobId: job.id },
      };
    }
    case 'ledger.entry':
      return {
        projectId: source.payload.entry.projectId,
        moduleId: WorkflowModuleId.LEDGER,
        edgeId: 'router-ledger',
        kind: 'completed',
        summary: `Recorded ${source.payload.entry.purpose} usage (${source.payload.entry.modelKey})`,
        refs: {
          ...refs,
          ledgerEntryId: source.payload.entry.id,
          ...(source.payload.entry.llmRequestId === undefined ? {} : { requestId: source.payload.entry.llmRequestId }),
          ...(source.payload.entry.conversationId === undefined
            ? {}
            : { conversationId: source.payload.entry.conversationId }),
          ...(source.payload.entry.pipelineRunId === undefined
            ? {}
            : { pipelineRunId: source.payload.entry.pipelineRunId }),
        },
        cost: source.payload.cost,
      };
    case 'budget.alert':
      return {
        projectId: source.payload.budget.projectId,
        moduleId: WorkflowModuleId.BUDGET_GUARD,
        edgeId: 'budget-router',
        kind: 'info',
        summary: `Budget ${source.payload.level}`,
        refs: {},
      };
    case 'pricing.updated':
      return {
        projectId,
        moduleId: WorkflowModuleId.PRICING_FX,
        edgeId: 'pricing-ledger',
        kind:
          source.payload.status === 'fetch_failed' || source.payload.status === 'rejected_validation'
            ? 'failed'
            : 'completed',
        summary: `Pricing update ${source.payload.status}`,
        refs: {},
      };
    case 'vscode.status':
      return {
        projectId,
        moduleId: WorkflowModuleId.VSCODE_BRIDGE,
        edgeId: 'worker-vscode',
        kind: 'info',
        summary: `VS Code ${source.payload.connected ? 'connected' : 'disconnected'}`,
        refs: {},
      };
    case 'vscode.diagnostics':
      return {
        projectId: source.payload.projectId,
        moduleId: WorkflowModuleId.VSCODE_BRIDGE,
        edgeId: 'worker-vscode',
        kind: source.payload.diagnostics.some((item) => item.severity === 'error') ? 'failed' : 'info',
        summary: `Received ${String(source.payload.diagnostics.length)} diagnostics`,
        refs: {},
      };
  }
}

export function mapWorkflowInternalEvent(
  source: WorkflowInternalEvent,
  costDisplay?: (microUsdAmount: number) => MoneyDisplay,
): ActivityMapping {
  switch (source.type) {
    case 'retriever':
      return {
        projectId: source.projectId,
        moduleId: WorkflowModuleId.RETRIEVER,
        edgeId: source.phase === 'started' ? 'query-retriever' : 'retriever-router',
        kind: source.phase === 'started' ? 'started' : 'completed',
        summary:
          source.phase === 'started'
            ? 'Retrieval started'
            : `Retrieved ${String(source.hitCount ?? 0)} hits${source.topScore === undefined ? '' : ` (top score ${source.topScore.toFixed(2)})`}`,
        refs: {},
        ...(source.durationMs === undefined ? {} : { durationMs: source.durationMs }),
      };
    case 'command':
      return {
        projectId: source.projectId ?? null,
        moduleId: WorkflowModuleId.COMMAND_RUNNER,
        edgeId: 'worker-commands',
        kind:
          source.phase === 'started' ? 'started' : source.timedOut || source.exitCode !== 0 ? 'failed' : 'completed',
        summary:
          source.phase === 'started'
            ? `Command started: ${source.executable} (${String(source.argCount)} args)`
            : `Command ${source.timedOut ? 'timed out' : source.exitCode === 0 ? 'finished' : `exited ${String(source.exitCode)}`}: ${source.executable} (${String(source.argCount)} args)`,
        refs: {
          commandRunId: source.commandRunId,
          ...(source.pipelineRunId === undefined ? {} : { pipelineRunId: source.pipelineRunId }),
        },
        ...(source.durationMs === undefined ? {} : { durationMs: source.durationMs }),
      };
    case 'vscode':
      return {
        projectId: source.projectId,
        moduleId: WorkflowModuleId.VSCODE_BRIDGE,
        edgeId: 'worker-vscode',
        kind: source.phase === 'sent' ? 'started' : 'completed',
        summary: `VS Code ${source.action} ${source.phase}${source.path === undefined ? '' : `: ${source.path}`}`,
        refs: {},
      };
    case 'image':
      return {
        projectId: source.projectId,
        moduleId: WorkflowModuleId.CHAT,
        edgeId: 'chat-router',
        kind: source.phase === 'started' ? 'started' : source.phase === 'failed' ? 'failed' : 'completed',
        summary: `Image generation ${source.phase}: ${source.provider}, ${String(source.count)} image${source.count === 1 ? '' : 's'}`,
        refs: {},
        ...(source.cost === undefined || costDisplay === undefined ? {} : { cost: costDisplay(source.cost) }),
      };
    case 'embedding':
      return {
        projectId: source.projectId,
        moduleId: WorkflowModuleId.EMBEDDINGS,
        edgeId: 'embeddings-ledger',
        kind: 'completed',
        summary: `Embedded ${String(source.chunkCount)} chunks with ${source.modelKey}`,
        refs: {},
        ...(costDisplay === undefined ? {} : { cost: costDisplay(source.cost) }),
      };
  }
}

export class ActivityRecorder {
  private readonly events: EventBus<RpcNotificationMap>;
  private readonly repository: Pick<ActivityRepository, 'insert' | 'query' | 'since' | 'prune'>;
  private readonly ids: IIdGenerator;
  private readonly clock: IClock;
  private readonly settings: Pick<SettingsService, 'get'>;
  private readonly aggregateCost: (microUsdAmount: number) => MoneyDisplay;
  private readonly vscodeBridgeAvailable: boolean;
  private readonly pending = new Map<string, ActivityEvent[]>();
  private readonly rings = new Map<string, ActivityEvent[]>();
  private readonly inFlight = new Map<string, Map<ModuleId, Set<string>>>();
  private readonly requestCorrelations = new Map<string, RequestCorrelation>();
  private readonly requestModels = new Map<string, string>();
  private readonly runCorrelations = new Map<string, ProjectId>();
  private readonly uncorrelatedEvents = new Map<string, SourceEvent[]>();
  private readonly unsubscribers: (() => void)[] = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly recording = new Set<Promise<void>>();
  private pruneTimer: ReturnType<typeof setInterval> | undefined;

  constructor(input: {
    events: EventBus<RpcNotificationMap>;
    repository: Pick<ActivityRepository, 'insert' | 'query' | 'since' | 'prune'>;
    ids: IIdGenerator;
    clock: IClock;
    settings: Pick<SettingsService, 'get'>;
    aggregateCost: (microUsdAmount: number) => MoneyDisplay;
    vscodeBridgeAvailable: boolean;
    internalEvents?: WorkflowInternalEventBus;
  }) {
    this.events = input.events;
    this.repository = input.repository;
    this.ids = input.ids;
    this.clock = input.clock;
    this.settings = input.settings;
    this.aggregateCost = input.aggregateCost;
    this.vscodeBridgeAvailable = input.vscodeBridgeAvailable;
    for (const name of [
      'router.event',
      'chat.delta',
      'chat.completed',
      'chat.failed',
      'pipeline.event',
      'pipeline.failureReport',
      'rag.progress',
      'ledger.entry',
      'budget.alert',
      'pricing.updated',
      'vscode.status',
      'vscode.diagnostics',
    ] as const) {
      this.unsubscribers.push(
        this.events.subscribe(name, (payload) => {
          this.trackRecord({ name, payload } as SourceEvent);
        }),
      );
    }
    if (input.internalEvents !== undefined)
      this.unsubscribers.push(
        input.internalEvents.subscribe((event) => {
          this.trackInternal(event);
        }),
      );
  }

  start(): void {
    this.repository.prune(this.clock.now());
    this.pruneTimer = setInterval(
      () => {
        this.repository.prune(this.clock.now());
      },
      60 * 60 * 1000,
    );
    this.pruneTimer.unref();
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.requestCorrelations.clear();
    this.requestModels.clear();
    this.runCorrelations.clear();
    this.uncorrelatedEvents.clear();
    if (this.pruneTimer !== undefined) clearInterval(this.pruneTimer);
  }

  correlateRequest(requestId: string, correlation: RequestCorrelation): void {
    this.remember(this.requestCorrelations, requestId, correlation);
    this.replayUncorrelated(requestId);
  }

  correlatePipelineRun(runId: string, projectId: ProjectId): void {
    this.remember(this.runCorrelations, runId, projectId);
    this.replayUncorrelated(runId);
  }

  async graph(projectId: ProjectId | null): Promise<WorkflowGraph> {
    await this.flushPendingRecords();
    const configured = await this.settings.get();
    const vscodeBridgeEnabled =
      this.vscodeBridgeAvailable && (configured.ok ? configured.value.vscode.autoLaunch : true);
    const since = new Date(this.clock.now().getTime() - 24 * 60 * 60 * 1000).toISOString();
    const events = this.repository.since(projectId, since);
    const callIds = new Map<ModuleId, Set<string>>();
    const errors = new Map<ModuleId, number>();
    const costAmounts = new Map<ModuleId, number>();
    const lastFlowAt = new Map<string, ActivityEvent['ts']>();
    for (const event of events) {
      const callId =
        event.refs.requestId ??
        event.refs.pipelineRunId ??
        event.refs.ingestJobId ??
        event.refs.commandRunId ??
        event.id;
      const ids = callIds.get(event.moduleId) ?? new Set<string>();
      ids.add(callId);
      callIds.set(event.moduleId, ids);
      if (event.kind === 'failed') errors.set(event.moduleId, (errors.get(event.moduleId) ?? 0) + 1);
      if (event.cost !== undefined)
        costAmounts.set(event.moduleId, (costAmounts.get(event.moduleId) ?? 0) + event.cost.microUsd);
      if (event.edgeId !== undefined && (lastFlowAt.get(event.edgeId) ?? '') < event.ts)
        lastFlowAt.set(event.edgeId, event.ts);
    }
    const active = new Map<ModuleId, number>();
    for (const [scope, modules] of this.inFlight)
      if (projectId === null || scope === projectId)
        for (const [moduleId, ids] of modules) active.set(moduleId, (active.get(moduleId) ?? 0) + ids.size);
    const costs = new Map<ModuleId, MoneyDisplay>();
    const calls = new Map<ModuleId, number>();
    for (const [moduleId, ids] of callIds) calls.set(moduleId, ids.size);
    for (const [moduleId, amount] of costAmounts) costs.set(moduleId, this.aggregateCost(amount));
    return workflowTopology({
      projectId,
      vscodeBridgeEnabled,
      generatedAt: this.clock.now(),
      inFlight: active,
      calls24h: calls,
      errors24h: errors,
      costs24h: costs,
      lastFlowAt,
    });
  }

  activity(projectId: ProjectId | null, limit: number, before?: string, moduleId?: ModuleId): readonly ActivityEvent[] {
    if (before === undefined) {
      const cached = projectId === null ? [...this.rings.values()].flat() : [...(this.rings.get(projectId) ?? [])];
      if (cached.length > 0)
        return cached
          .filter((event) => moduleId === undefined || event.moduleId === moduleId)
          .slice(-limit)
          .reverse();
    }
    return this.repository.query(projectId, limit, before, moduleId);
  }

  private async record(source: SourceEvent): Promise<void> {
    if (
      source.name === 'router.event' &&
      source.payload.type === 'state' &&
      (source.payload.state === 'dispatching' || source.payload.state === 'streaming') &&
      source.payload.modelKey !== undefined
    )
      this.remember(this.requestModels, source.payload.requestId, source.payload.modelKey);
    const succeededModel =
      source.name === 'router.event' && source.payload.type === 'state' && source.payload.state === 'succeeded'
        ? (source.payload.modelKey ?? this.requestModels.get(source.payload.requestId))
        : undefined;
    const correlationId = sourceCorrelationId(source);
    const requestCorrelation = correlationId === undefined ? undefined : this.requestCorrelations.get(correlationId);
    const runProjectId = correlationId === undefined ? undefined : this.runCorrelations.get(correlationId);
    if (correlationId !== undefined && requestCorrelation === undefined && runProjectId === undefined) {
      const waiting = this.uncorrelatedEvents.get(correlationId) ?? [];
      waiting.push(source);
      this.uncorrelatedEvents.set(correlationId, waiting.slice(-MAX_UNCORRELATED_EVENTS));
      while (this.uncorrelatedEvents.size > MAX_UNCORRELATED_EVENTS) {
        const oldest = this.uncorrelatedEvents.keys().next().value;
        if (oldest === undefined) break;
        this.uncorrelatedEvents.delete(oldest);
      }
      return;
    }
    const id = activityEventIdSchema.parse(this.ids.uuid());
    const now = isoDateTimeSchema.parse(this.clock.now().toISOString());
    const scope =
      source.name === 'rag.progress'
        ? source.payload.projectId
        : source.name === 'ledger.entry'
          ? source.payload.entry.projectId
          : source.name === 'budget.alert'
            ? source.payload.budget.projectId
            : source.name === 'vscode.diagnostics'
              ? source.payload.projectId
              : null;
    const configured = await this.settings.get();
    const selectedProject =
      scope ??
      requestCorrelation?.projectId ??
      runProjectId ??
      (configured.ok ? configured.value.activeProjectId : null);
    const refs = requestCorrelation === undefined ? {} : { conversationId: requestCorrelation.conversationId };
    const mapped = mapWorkflowEvent(source, selectedProject, refs);
    const event: ActivityEvent = { id, ts: now, ...mapped, summary: redactLogLine(mapped.summary).slice(0, 500) };
    const storedEvent: ActivityEvent =
      succeededModel === undefined
        ? event
        : { ...event, summary: redactLogLine(`Router completed on ${succeededModel}`).slice(0, 500) };
    await this.repository.insert(storedEvent);
    const projectKey = selectedProject ?? '*';
    const ring = this.rings.get(projectKey) ?? [];
    ring.push(storedEvent);
    this.rings.set(projectKey, ring.slice(-500));
    const key = projectKey;
    const pending = this.pending.get(key) ?? [];
    pending.push(storedEvent);
    this.pending.set(key, pending);
    this.updateFlight(selectedProject, storedEvent);
    if (!this.timers.has(key))
      this.timers.set(
        key,
        setTimeout(() => {
          this.flush(key);
        }, 250),
      );
    if (
      correlationId !== undefined &&
      (source.name === 'chat.completed' ||
        source.name === 'chat.failed' ||
        (source.name === 'pipeline.event' && source.payload.type === 'finished'))
    ) {
      this.requestCorrelations.delete(correlationId);
      this.requestModels.delete(correlationId);
      this.runCorrelations.delete(correlationId);
    }
  }

  private replayUncorrelated(id: string): void {
    const queued = this.uncorrelatedEvents.get(id);
    if (queued === undefined) return;
    this.uncorrelatedEvents.delete(id);
    for (const source of queued) this.trackRecord(source);
  }

  private trackRecord(source: SourceEvent): void {
    const pending = this.record(source);
    this.recording.add(pending);
    void pending.then(
      () => this.recording.delete(pending),
      () => this.recording.delete(pending),
    );
  }

  private trackInternal(source: WorkflowInternalEvent): void {
    const pending = this.recordInternal(source);
    this.recording.add(pending);
    void pending.then(
      () => this.recording.delete(pending),
      () => this.recording.delete(pending),
    );
  }

  private async recordInternal(source: WorkflowInternalEvent): Promise<void> {
    const configured = await this.settings.get();
    const projectId =
      source.type === 'command'
        ? (source.projectId ?? (configured.ok ? configured.value.activeProjectId : null))
        : source.projectId;
    const mapped = mapWorkflowInternalEvent(source, this.aggregateCost);
    const id = activityEventIdSchema.parse(this.ids.uuid());
    const ts = isoDateTimeSchema.parse(this.clock.now().toISOString());
    const event: ActivityEvent = {
      id,
      ts,
      ...mapped,
      projectId,
      summary: redactLogLine(mapped.summary).slice(0, 500),
    };
    await this.repository.insert(event);
    const key = projectId ?? '*';
    const ring = this.rings.get(key) ?? [];
    ring.push(event);
    this.rings.set(key, ring.slice(-500));
    const pending = this.pending.get(key) ?? [];
    pending.push(event);
    this.pending.set(key, pending);
    this.updateFlight(projectId, event);
    if (!this.timers.has(key))
      this.timers.set(
        key,
        setTimeout(() => {
          this.flush(key);
        }, 250),
      );
  }

  private async flushPendingRecords(): Promise<void> {
    while (this.recording.size > 0) await Promise.allSettled([...this.recording]);
  }

  private remember<T>(map: Map<string, T>, id: string, value: T): void {
    map.delete(id);
    map.set(id, value);
    while (map.size > MAX_CORRELATIONS) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  private updateFlight(projectId: ProjectId | null, event: ActivityEvent): void {
    const key = projectId ?? '*';
    const modules = this.inFlight.get(key) ?? new Map<ModuleId, Set<string>>();
    const items = modules.get(event.moduleId) ?? new Set<string>();
    const identity =
      event.refs.requestId ?? event.refs.pipelineRunId ?? event.refs.ingestJobId ?? event.refs.commandRunId ?? event.id;
    if (
      event.kind === 'started' ||
      (event.moduleId === WorkflowModuleId.CHAT && event.kind === 'progress' && event.refs.requestId !== undefined)
    )
      items.add(identity);
    else if (event.kind === 'completed' || event.kind === 'failed') items.delete(identity);
    modules.set(event.moduleId, items);
    if (
      event.refs.pipelineRunId !== undefined &&
      (event.kind === 'started' || event.kind === 'completed' || event.kind === 'failed')
    ) {
      for (const [moduleId, open] of modules) {
        if (moduleId === event.moduleId || !PIPELINE_MODULES.has(moduleId)) continue;
        open.delete(event.refs.pipelineRunId);
      }
    }
    if (event.refs.requestId !== undefined && (event.kind === 'completed' || event.kind === 'failed')) {
      for (const [moduleId, open] of modules) {
        if (
          moduleId === event.moduleId ||
          (moduleId !== WorkflowModuleId.ROUTER &&
            moduleId !== WorkflowModuleId.PROVIDERS &&
            moduleId !== WorkflowModuleId.CHAT)
        )
          continue;
        open.delete(event.refs.requestId);
      }
    }
    this.inFlight.set(key, modules);
  }

  private flush(key: string): void {
    this.timers.delete(key);
    const batch = this.pending.get(key) ?? [];
    this.pending.delete(key);
    if (batch.length > 0) this.events.publish('workflow.activity', batch);
    if (this.pending.has(key))
      this.timers.set(
        key,
        setTimeout(() => {
          this.flush(key);
        }, 250),
      );
  }
}

function sourceCorrelationId(source: SourceEvent): string | undefined {
  switch (source.name) {
    case 'chat.delta':
    case 'chat.completed':
    case 'chat.failed':
      return source.payload.requestId;
    case 'router.event':
      return source.payload.type === 'circuit' ? undefined : source.payload.requestId;
    case 'pipeline.event':
      return source.payload.runId;
    case 'pipeline.failureReport':
      return source.payload.runId;
    case 'budget.alert':
    case 'ledger.entry':
    case 'pricing.updated':
    case 'rag.progress':
    case 'vscode.diagnostics':
    case 'vscode.status':
      return undefined;
  }
}
