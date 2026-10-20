import { microUsd, toMoneyDisplay } from '../../kernel/domain/money.js';
import { ActivityRepository } from '../../kernel/infra/sqlite/activity-repository.js';
import type { ModuleContext } from '../../kernel/module-context.js';
import type { WorkflowInternalEvent } from '../../kernel/ports/workflow-internal-events.js';
import { EventBus } from '../../kernel/rpc/event-bus.js';
import type { CostModule } from '../cost/index.js';
import type { SettingsService } from '../settings/index.js';
import { ActivityRecorder } from './services/activity-recorder.js';

export interface WorkflowModuleDependencies {
  readonly settings: SettingsService;
  readonly cost: CostModule;
  readonly vscodeBridgeAvailable: boolean;
}

/** Workflow map: the internal activity bus other modules publish to, and the recorder that aggregates it. */
export function createWorkflowModule(ctx: ModuleContext, deps: WorkflowModuleDependencies) {
  const bus = new EventBus<{ activity: WorkflowInternalEvent }>();
  const internalEvents = {
    publish: (event: WorkflowInternalEvent) => {
      bus.publish('activity', event);
    },
    subscribe: (handler: (event: WorkflowInternalEvent) => void) => bus.subscribe('activity', handler),
  };
  const recorder = new ActivityRecorder({
    logger: ctx.logger,
    events: ctx.events,
    repository: new ActivityRepository(ctx.db),
    ids: ctx.ids,
    clock: ctx.clock,
    settings: deps.settings,
    aggregateCost: (amount) => toMoneyDisplay(microUsd(amount), deps.cost.fx.getEffective()),
    vscodeBridgeAvailable: deps.vscodeBridgeAvailable,
    internalEvents,
  });
  return { internalEvents, recorder };
}

export type WorkflowModule = ReturnType<typeof createWorkflowModule>;
export { registerWorkflowRpc } from './rpc.js';
