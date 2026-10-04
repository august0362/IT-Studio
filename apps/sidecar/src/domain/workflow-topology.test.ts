import { describe, expect, it } from 'vitest';
import { WorkflowModuleId } from '@itstudio/schemas';
import { workflowTopology, WORKFLOW_EDGES } from './workflow-topology.js';

describe('workflowTopology', () => {
  it('TC-MW-005 matches the exact module lanes and edge contracts in ARCHITECTURE §13.1', () => {
    const graph = workflowTopology({
      projectId: null,
      vscodeBridgeEnabled: true,
      generatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(Object.fromEntries(graph.nodes.map((node) => [node.id, node.lane]))).toEqual({
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
    });
    expect(graph.edges.map(({ id, from, to, contract }) => [id, from, to, contract])).toEqual([
      ['chat-router', 'chat', 'router', 'LlmRequest'],
      ['code-pm', 'code', 'pipeline_pm', 'PipelineRun'],
      ['pm-coder', 'pipeline_pm', 'pipeline_coder', 'TaskSpec'],
      ['coder-reviewer', 'pipeline_coder', 'pipeline_reviewer', 'CoderOutput'],
      ['reviewer-worker', 'pipeline_reviewer', 'worker', 'ReviewVerdict'],
      ['worker-files', 'worker', 'workspace_fs', 'FileOperation[]'],
      ['worker-commands', 'worker', 'command_runner', 'CommandSpec'],
      ['worker-vscode', 'worker', 'vscode_bridge', 'TransactionId'],
      ['knowledge-ingest', 'knowledge', 'rag_ingest', 'IngestJob'],
      ['ingest-embeddings', 'rag_ingest', 'embeddings', 'IngestJob'],
      ['ingest-vectors', 'rag_ingest', 'vector_store', 'SourceDocument[]'],
      ['query-retriever', 'chat', 'retriever', 'RetrievalQuery'],
      ['retriever-vectors', 'retriever', 'vector_store', 'RetrievalQuery'],
      ['retriever-router', 'retriever', 'router', 'RetrievalHit[]'],
      ['router-providers', 'router', 'providers', 'LlmRequest'],
      ['budget-router', 'budget_guard', 'router', 'BudgetStatus'],
      ['router-ledger', 'router', 'ledger', 'LlmResponse'],
      ['embeddings-ledger', 'embeddings', 'ledger', 'LedgerEntry'],
      ['ledger-pnl', 'ledger', 'pnl', 'LedgerEntry'],
      ['pricing-ledger', 'pricing_fx', 'ledger', 'PriceTable'],
      ['storage-ledger', 'ledger', 'storage', 'LedgerEntry'],
      ['storage-chat', 'chat', 'storage', 'ChatMessage'],
      ['storage-pipeline', 'worker', 'storage', 'PipelineRun'],
    ]);
  });

  it('catalogues every workflow module and assigns a contract to every edge', () => {
    const graph = workflowTopology({
      projectId: null,
      vscodeBridgeEnabled: true,
      generatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(Object.values(WorkflowModuleId).sort());
    expect(WORKFLOW_EDGES.every((item) => item.contract.length > 0)).toBe(true);
    expect(
      graph.edges.every(
        (item) => graph.nodes.some((node) => node.id === item.from) && graph.nodes.some((node) => node.id === item.to),
      ),
    ).toBe(true);
  });

  it('disables the VS Code module when the bridge is off and reflects live counts', () => {
    const counts = new Map([[WorkflowModuleId.CHAT, 3]]);
    const graph = workflowTopology({
      projectId: null,
      vscodeBridgeEnabled: false,
      generatedAt: new Date('2026-01-01T00:00:00.000Z'),
      inFlight: counts,
      calls24h: counts,
    });
    expect(graph.nodes.find((node) => node.id === WorkflowModuleId.VSCODE_BRIDGE)?.status).toBe('disabled');
    expect(graph.nodes.find((node) => node.id === WorkflowModuleId.CHAT)).toMatchObject({
      status: 'active',
      inFlight: 3,
      calls24h: 3,
    });
  });
});
