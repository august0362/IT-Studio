import { getNodesBounds, getViewportForBounds } from '@xyflow/react';
import type * as FlowTypes from '@xyflow/react';
import { WorkflowModuleId, type WorkflowNode } from '@itstudio/schemas';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '../../i18n';
import { WorkflowGraph } from './WorkflowGraph';
import { layoutWorkflow } from './layout';

const captured = vi.hoisted(
  (): { flow: Record<string, unknown>; controls: Record<string, unknown>; fit: ReturnType<typeof vi.fn> } => ({
    flow: {},
    controls: {},
    fit: vi.fn(),
  }),
);
vi.mock('@xyflow/react', async (importOriginal) => {
  const original = await importOriginal<typeof FlowTypes>();
  return {
    ...original,
    useReactFlow: () => ({ fitView: captured.fit }),
    useNodesInitialized: () => true,
    ReactFlow: (props: Record<string, unknown>) => {
      captured.flow = props;
      return props.children;
    },
    Controls: (props: Record<string, unknown>) => {
      captured.controls = props;
      return null;
    },
    Background: () => null,
    MiniMap: () => null,
  };
});
afterEach(cleanup);

it.each([
  [1280, 800],
  [1580, 1000],
])('M9-OBS-03 fits every layout bound initially and from controls at %s × %s', (width, height) => {
  const nodes: WorkflowNode[] = Object.values(WorkflowModuleId).map((id, index) => ({
    id,
    lane: index < 9 ? 'engine' : 'storage',
    labelKey: 'workflow.module.chat',
    status: 'idle',
    inFlight: 0,
    calls24h: 0,
    errors24h: 0,
  }));
  render(
    <WorkflowGraph
      nodes={nodes}
      edges={[]}
      pulses={{}}
      activeEdges={{}}
      edgeAnimations={[]}
      onSelect={() => undefined}
    />,
  );
  const options = captured.flow.fitViewOptions as { padding: number; minZoom: number; maxZoom: number };
  expect(captured.flow.minZoom).toBeLessThan(0.5);
  expect(captured.controls.fitViewOptions).toEqual(options);
  expect(captured.fit).toHaveBeenCalledWith(options);
  const layout = layoutWorkflow(nodes, []);
  expect(layout.nodes.every((node) => node.initialWidth === 240 && node.initialHeight === 168)).toBe(true);
  const bounds = getNodesBounds([...layout.nodes]);
  // Allow room for the app navigation, heading and the open module panel.
  const viewportWidth = width - 600;
  const viewportHeight = height - 240;
  const viewport = getViewportForBounds(
    bounds,
    viewportWidth,
    viewportHeight,
    options.minZoom,
    options.maxZoom,
    options.padding,
  );
  for (const node of layout.nodes) {
    expect(node.position.x * viewport.zoom + viewport.x).toBeGreaterThanOrEqual(0);
    expect(node.position.y * viewport.zoom + viewport.y).toBeGreaterThanOrEqual(0);
    expect((node.position.x + 240) * viewport.zoom + viewport.x).toBeLessThanOrEqual(viewportWidth);
    expect((node.position.y + 168) * viewport.zoom + viewport.y).toBeLessThanOrEqual(viewportHeight);
  }
});
