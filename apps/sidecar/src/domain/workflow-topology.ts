import {
  WorkflowModuleId,
  type MoneyDisplay,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowLane,
  type WorkflowModuleId as ModuleId,
  type WorkflowNode,
  type ProjectId,
} from '@itstudio/schemas';
import { isoDateTimeSchema } from '../validation/brand.js';

const laneByModule: Readonly<Record<ModuleId, WorkflowLane>> = {
  chat: 'ui',
  code: 'ui',
  knowledge: 'ui',
  router: 'engine',
  providers: 'engine',
  budget_guard: 'engine',
  ledger: 'data',
  pnl: 'data',
  pricing_fx: 'data',
  rag_ingest: 'engine',
  embeddings: 'engine',
  vector_store: 'storage',
  retriever: 'engine',
  pipeline_pm: 'pipeline',
  pipeline_coder: 'pipeline',
  pipeline_reviewer: 'pipeline',
  worker: 'pipeline',
  command_runner: 'pipeline',
  workspace_fs: 'storage',
  vscode_bridge: 'engine',
  storage: 'storage',
};

export const WORKFLOW_EDGES: readonly WorkflowEdge[] = [
  { id: 'chat-router', from: 'chat', to: 'router', contract: 'LlmRequest' },
  { id: 'code-pm', from: 'code', to: 'pipeline_pm', contract: 'PipelineRun' },
  { id: 'pm-coder', from: 'pipeline_pm', to: 'pipeline_coder', contract: 'TaskSpec' },
  { id: 'coder-reviewer', from: 'pipeline_coder', to: 'pipeline_reviewer', contract: 'CoderOutput' },
  { id: 'reviewer-worker', from: 'pipeline_reviewer', to: 'worker', contract: 'ReviewVerdict' },
  { id: 'worker-files', from: 'worker', to: 'workspace_fs', contract: 'FileOperation[]' },
  { id: 'worker-commands', from: 'worker', to: 'command_runner', contract: 'CommandSpec' },
  { id: 'worker-vscode', from: 'worker', to: 'vscode_bridge', contract: 'TransactionId' },
  { id: 'knowledge-ingest', from: 'knowledge', to: 'rag_ingest', contract: 'IngestJob' },
  { id: 'ingest-embeddings', from: 'rag_ingest', to: 'embeddings', contract: 'IngestJob' },
  { id: 'ingest-vectors', from: 'rag_ingest', to: 'vector_store', contract: 'SourceDocument[]' },
  { id: 'query-retriever', from: 'chat', to: 'retriever', contract: 'RetrievalQuery' },
  { id: 'retriever-vectors', from: 'retriever', to: 'vector_store', contract: 'RetrievalQuery' },
  { id: 'retriever-router', from: 'retriever', to: 'router', contract: 'RetrievalHit[]' },
  { id: 'router-providers', from: 'router', to: 'providers', contract: 'LlmRequest' },
  { id: 'budget-router', from: 'budget_guard', to: 'router', contract: 'BudgetStatus' },
  { id: 'router-ledger', from: 'router', to: 'ledger', contract: 'LlmResponse' },
  { id: 'embeddings-ledger', from: 'embeddings', to: 'ledger', contract: 'LedgerEntry' },
  { id: 'ledger-pnl', from: 'ledger', to: 'pnl', contract: 'LedgerEntry' },
  { id: 'pricing-ledger', from: 'pricing_fx', to: 'ledger', contract: 'PriceTable' },
  { id: 'storage-ledger', from: 'ledger', to: 'storage', contract: 'LedgerEntry' },
  { id: 'storage-chat', from: 'chat', to: 'storage', contract: 'ChatMessage' },
  { id: 'storage-pipeline', from: 'worker', to: 'storage', contract: 'PipelineRun' },
];

export function workflowTopology(input: {
  readonly projectId: ProjectId | null;
  readonly vscodeBridgeEnabled: boolean;
  readonly generatedAt: Date;
  readonly inFlight?: ReadonlyMap<ModuleId, number>;
  readonly calls24h?: ReadonlyMap<ModuleId, number>;
  readonly errors24h?: ReadonlyMap<ModuleId, number>;
  readonly costs24h?: ReadonlyMap<ModuleId, MoneyDisplay>;
  readonly lastFlowAt?: ReadonlyMap<string, WorkflowEdge['lastFlowAt']>;
}): WorkflowGraph {
  const nodes: WorkflowNode[] = Object.values(WorkflowModuleId).map((id) => {
    const disabled = id === WorkflowModuleId.VSCODE_BRIDGE && !input.vscodeBridgeEnabled;
    const inFlight = input.inFlight?.get(id) ?? 0;
    const cost24h = input.costs24h?.get(id);
    return {
      id,
      lane: laneByModule[id],
      labelKey: `workflow.module.${id}`,
      status: disabled ? 'disabled' : inFlight > 0 ? 'active' : (input.errors24h?.get(id) ?? 0) > 0 ? 'error' : 'idle',
      inFlight,
      calls24h: input.calls24h?.get(id) ?? 0,
      errors24h: input.errors24h?.get(id) ?? 0,
      ...(cost24h === undefined ? {} : { cost24h }),
    };
  });
  return {
    projectId: input.projectId,
    nodes,
    edges: WORKFLOW_EDGES.map((edge) => {
      const lastFlowAt = input.lastFlowAt?.get(edge.id);
      return lastFlowAt === undefined ? edge : { ...edge, lastFlowAt };
    }),
    generatedAt: isoDateTimeSchema.parse(input.generatedAt.toISOString()),
  };
}
