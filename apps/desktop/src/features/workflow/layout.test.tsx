import type { WorkflowEdge, WorkflowNode } from '@itstudio/schemas';
import { describe, expect, it } from 'vitest';
import { layoutWorkflow } from './layout';

const nodes: readonly WorkflowNode[] = [
  {
    id: 'router',
    lane: 'engine',
    labelKey: 'workflow.module.router',
    status: 'active',
    inFlight: 0,
    calls24h: 0,
    errors24h: 0,
  },
  { id: 'chat', lane: 'ui', labelKey: 'workflow.module.chat', status: 'idle', inFlight: 0, calls24h: 0, errors24h: 0 },
  { id: 'code', lane: 'ui', labelKey: 'workflow.module.code', status: 'idle', inFlight: 0, calls24h: 0, errors24h: 0 },
];
const edges: readonly WorkflowEdge[] = [{ id: 'chat-router', from: 'chat', to: 'router', contract: 'LlmRequest' }];

describe('layoutWorkflow', () => {
  it('orders lanes and ids deterministically without overlapping nodes', () => {
    const result = layoutWorkflow(nodes, edges);
    expect(result.nodes.map(({ id, position }) => ({ id, position }))).toEqual([
      { id: 'chat', position: { x: 32, y: 32 } },
      { id: 'code', position: { x: 344, y: 32 } },
      { id: 'router', position: { x: 32, y: 312 } },
    ]);
    expect(new Set(result.nodes.map(({ position }) => `${String(position.x)}:${String(position.y)}`)).size).toBe(
      nodes.length,
    );
    expect(result.edges[0]).toMatchObject({ id: 'chat-router', source: 'chat', target: 'router', label: 'LlmRequest' });
  });

  it('flags pulsing nodes and keeps contracts attached to edges', () => {
    const result = layoutWorkflow(nodes, edges, new Set(['router']));
    expect(result.nodes.map(({ data }) => data.pulsing)).toContain(true);
    expect(result.edges[0]?.label).toBe('LlmRequest');
  });
});
