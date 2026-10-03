import {
  WorkflowModuleId,
  type ActivityEvent,
  type ActivityKind,
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
            ? `Router ${event.state}${event.modelKey === undefined ? '' : ` on ${event.modelKey}`}`
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
  private readonly unsubscribers: (() => void)[] = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pruneTimer: ReturnType<typeof setInterval> | undefined;

  constructor(input: {
    events: EventBus<RpcNotificationMap>;
    repository: Pick<ActivityRepository, 'insert' | 'query' | 'since' | 'prune'>;
    ids: IIdGenerator;
    clock: IClock;
    settings: Pick<SettingsService, 'get'>;
    aggregateCost: (microUsdAmount: number) => MoneyDisplay;
    vscodeBridgeAvailable: boolean;
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
          void this.record({ name, payload } as SourceEvent);
        }),
      );
    }
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
    if (this.pruneTimer !== undefined) clearInterval(this.pruneTimer);
  }

  async graph(projectId: ProjectId | null): Promise<WorkflowGraph> {
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
    const selectedProject = scope ?? (configured.ok ? configured.value.activeProjectId : null);
    const mapped = mapWorkflowEvent(source, selectedProject);
    const event: ActivityEvent = { id, ts: now, ...mapped, summary: redactLogLine(mapped.summary).slice(0, 500) };
    await this.repository.insert(event);
    const projectKey = selectedProject ?? '*';
    const ring = this.rings.get(projectKey) ?? [];
    ring.push(event);
    this.rings.set(projectKey, ring.slice(-500));
    const key = projectKey;
    const pending = this.pending.get(key) ?? [];
    pending.push(event);
    this.pending.set(key, pending);
    this.updateFlight(selectedProject, event);
    if (!this.timers.has(key))
      this.timers.set(
        key,
        setTimeout(() => {
          this.flush(key);
        }, 250),
      );
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
