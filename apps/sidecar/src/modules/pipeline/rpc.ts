import { ErrorCode } from '@itstudio/schemas';
import type { StartupGate } from '../../kernel/module-context.js';
import type { RpcServer } from '../../kernel/rpc/rpc-server.js';
import type { ProjectsModule } from '../projects/index.js';
import type { WorkflowModule } from '../workflow/index.js';
import type { PipelineModule } from './index.js';

export interface PipelineRpcDependencies {
  readonly projects: ProjectsModule;
  readonly workflow: WorkflowModule;
  readonly ready: StartupGate;
}

export function registerPipelineRpc(
  server: RpcServer,
  { orchestrator }: PipelineModule,
  deps: PipelineRpcDependencies,
): void {
  const { ready } = deps;
  server.register('pipeline.start', async (input) => {
    await ready();
    if (deps.projects.service.isDeleting(input.projectId))
      return {
        ok: false,
        error: {
          code: ErrorCode.CONFLICT,
          message: 'Project deletion is in progress.',
          retryable: false,
          remediation: ['Wait for project deletion to finish.'],
        },
      };
    const result = await orchestrator.start(input);
    if (result.ok) deps.workflow.recorder.correlatePipelineRun(result.value.id, result.value.projectId);
    return result;
  });
  server.register('pipeline.get', async ({ runId }) => {
    await ready();
    const run = await orchestrator.get(runId);
    return run === null
      ? {
          ok: false,
          error: {
            code: ErrorCode.NOT_FOUND,
            message: 'Pipeline run was not found.',
            retryable: false,
            remediation: ['Refresh the pipeline list and select an existing run.'],
          },
        }
      : { ok: true, value: run };
  });
  server.register('pipeline.list', async (input) => {
    await ready();
    return { ok: true, value: await orchestrator.list(input) };
  });
  server.register('pipeline.cancel', async ({ runId }) => {
    await ready();
    const run = await orchestrator.cancel(runId);
    return run === null
      ? {
          ok: false,
          error: {
            code: ErrorCode.NOT_FOUND,
            message: 'Pipeline run was not found.',
            retryable: false,
            remediation: ['Refresh the pipeline list and select an existing run.'],
          },
        }
      : { ok: true, value: run };
  });
  server.register('pipeline.answerClarifications', async (input) => {
    await ready();
    return orchestrator.answerClarifications(input);
  });
}
