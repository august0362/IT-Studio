import type { RpcServer } from '../../kernel/rpc/rpc-server.js';
import type { WorkflowModule } from './index.js';

export function registerWorkflowRpc(server: RpcServer, { recorder }: WorkflowModule): void {
  server.register('workflow.graph', ({ projectId }) =>
    recorder.graph(projectId).then((value) => ({ ok: true as const, value })),
  );
  server.register('workflow.activity', ({ projectId, moduleId, limit, before }) =>
    Promise.resolve({
      ok: true,
      value: recorder.activity(projectId, limit, before, moduleId),
    }),
  );
}
