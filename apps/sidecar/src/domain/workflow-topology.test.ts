import { describe, expect, it } from 'vitest';
import { WorkflowModuleId } from '@itstudio/schemas';
import { workflowTopology, WORKFLOW_EDGES } from './workflow-topology.js';

describe('workflowTopology', () => {
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
