import { ErrorCode, type PipelineRun, type PipelineRunId, type ProcessId, type Result } from '@itstudio/schemas';
import { assertNever } from '../../kernel/domain/assert.js';
import { ProcessRepository } from '../../kernel/infra/sqlite/process-repository.js';
import type { ModuleContext } from '../../kernel/module-context.js';
import type { ProcessOperation } from '../../kernel/ports/process-tracker.js';
import { pipelineRunIdSchema } from '../../kernel/validation/brand.js';
import { ProcessRegistry } from './services/process-registry.js';

type OperationParams<K extends ProcessOperation['kind']> = Extract<ProcessOperation, { readonly kind: K }>['params'];

/** The owning service that re-runs each persisted operation kind on retry. */
export type ProcessOperationHandlers = {
  readonly [K in ProcessOperation['kind']]: (
    params: OperationParams<K>,
    retryOf: ProcessId,
  ) => Promise<Result<unknown>>;
};

export interface ProcessesModuleDependencies {
  readonly handlers: ProcessOperationHandlers;
  readonly cancelPipeline: (id: PipelineRunId) => Promise<PipelineRun | null>;
}

export function createProcessesModule(ctx: ModuleContext, deps: ProcessesModuleDependencies) {
  const { handlers } = deps;
  const registry: ProcessRegistry = new ProcessRegistry({
    repository: new ProcessRepository(ctx.db),
    events: ctx.events,
    clock: ctx.clock,
    ids: ctx.ids,
    logger: ctx.logger,
    dispatch: async (operation, retryOf): Promise<Result<unknown>> => {
      switch (operation.kind) {
        case 'chat':
          return handlers.chat(operation.params, retryOf);
        case 'code_pipeline':
          return handlers.code_pipeline(operation.params, retryOf);
        case 'knowledge_ingest':
          return handlers.knowledge_ingest(operation.params, retryOf);
        case 'image':
          return handlers.image(operation.params, retryOf);
        case 'price_update':
          return handlers.price_update(operation.params, retryOf);
        case 'key_verify':
          return handlers.key_verify(operation.params, retryOf);
        default:
          return assertNever(operation);
      }
    },
    cancelRecovered: async (process): Promise<Result<unknown>> => {
      if (process.kind === 'code_pipeline' && process.ref?.type === 'pipeline_run') {
        const id = pipelineRunIdSchema.safeParse(process.ref.id);
        if (id.success) return { ok: true, value: await deps.cancelPipeline(id.data) };
      }
      if (process.kind === 'web_chat') return { ok: true, value: undefined };
      return {
        ok: false,
        error: {
          code: ErrorCode.VALIDATION,
          message: 'This operation cannot be cancelled.',
          retryable: false,
          remediation: ['Wait for the operation to finish.'],
        },
      };
    },
  });
  return { registry };
}

export type ProcessesModule = ReturnType<typeof createProcessesModule>;
export { ProcessRegistry } from './services/process-registry.js';
export { registerProcessesRpc } from './rpc.js';
