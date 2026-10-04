import type { ActivityEvent, ActivityEventId, IsoDateTime, WorkflowGraph, WorkflowNode } from '@itstudio/schemas';
import { describe, expect, it } from 'vitest';
import { initialWorkflowState, workflowReducer } from './workflow-store';

const chat: WorkflowNode = {
  id: 'chat',
  lane: 'ui',
  labelKey: 'workflow.module.chat',
  status: 'idle',
  inFlight: 0,
  calls24h: 2,
  errors24h: 0,
};
const graph: WorkflowGraph = {
  projectId: null,
  nodes: [chat],
  edges: [],
  generatedAt: '2026-10-04T00:00:00.000Z' as IsoDateTime,
};
function event(moduleId: ActivityEvent['moduleId'], kind: ActivityEvent['kind'], edgeId?: string): ActivityEvent {
  return {
    id: `${kind}-${moduleId}-${edgeId ?? 'no-edge'}` as ActivityEventId,
    projectId: null,
    moduleId,
    ...(edgeId === undefined ? {} : { edgeId }),
    kind,
    summary: '3 tokens',
    refs: {},
    ts: '2026-10-04T00:00:00.000Z' as IsoDateTime,
  };
}

describe('workflowReducer', () => {
  it('accepts a graph snapshot and applies a batch to known nodes and edges', () => {
    const loaded = workflowReducer(initialWorkflowState, { type: 'graph', graph });
    const state = workflowReducer(loaded, {
      type: 'activity',
      now: 1000,
      events: [event('chat', 'started', 'chat-router'), event('chat', 'progress')],
    });
    expect(state.graph?.nodes[0]).toMatchObject({ status: 'active', inFlight: 1, calls24h: 3 });
    expect(state.pulses.chat).toBe(2500);
    expect(state.activeEdges['chat-router']).toBe(2500);
    expect(state.events).toHaveLength(2);
  });

  it('ignores unknown modules and empty activity batches', () => {
    const loaded = workflowReducer(initialWorkflowState, { type: 'graph', graph });
    expect(workflowReducer(loaded, { type: 'activity', now: 0, events: [] })).toBe(loaded);
    expect(workflowReducer(loaded, { type: 'activity', now: 0, events: [event('router', 'started')] })).toBe(loaded);
    expect(
      workflowReducer(initialWorkflowState, { type: 'activity', now: 0, events: [event('chat', 'started')] }),
    ).toBe(initialWorkflowState);
  });

  it('updates completion and failure counters and floors in-flight count at zero', () => {
    const loaded = workflowReducer(initialWorkflowState, {
      type: 'graph',
      graph: { ...graph, nodes: [{ ...chat, inFlight: 1 }] },
    });
    const complete = workflowReducer(loaded, { type: 'activity', now: 0, events: [event('chat', 'completed')] });
    const failed = workflowReducer(complete, { type: 'activity', now: 1, events: [event('chat', 'failed')] });
    expect(failed.graph?.nodes[0]).toMatchObject({ status: 'error', inFlight: 0, errors24h: 1 });
  });

  it('leaves status unchanged for informational events', () => {
    const loaded = workflowReducer(initialWorkflowState, { type: 'graph', graph });
    const state = workflowReducer(loaded, { type: 'activity', now: 0, events: [event('chat', 'info')] });
    expect(state.graph?.nodes[0]?.status).toBe('idle');
  });

  it('expires pulses and edges when their deadline passes and preserves state otherwise', () => {
    const active = workflowReducer(workflowReducer(initialWorkflowState, { type: 'graph', graph }), {
      type: 'activity',
      now: 0,
      events: [event('chat', 'started', 'chat-router')],
    });
    expect(workflowReducer(active, { type: 'expire', now: 1499 })).toBe(active);
    const expired = workflowReducer(active, { type: 'expire', now: 1500 });
    expect(expired.pulses).toEqual({});
    expect(expired.activeEdges).toEqual({});
  });
});
