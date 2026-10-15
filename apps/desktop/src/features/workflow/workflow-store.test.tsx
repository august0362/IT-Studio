import type { ActivityEvent, ActivityEventId, IsoDateTime, WorkflowGraph, WorkflowNode } from '@itstudio/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  edges: [{ id: 'chat-router', from: 'chat', to: 'chat', contract: 'LlmRequest' }],
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
  it('M9-OBS-05 counts repeated starts and terminal deliveries once per request', () => {
    const refs = {
      requestId: '00000000-0000-4000-8000-000000000001' as NonNullable<ActivityEvent['refs']['requestId']>,
    };
    let state = workflowReducer(initialWorkflowState, { type: 'graph', graph });
    const send = (id: string, kind: ActivityEvent['kind']) => {
      state = workflowReducer(state, {
        type: 'activity',
        now: 0,
        events: [{ ...event('chat', kind), id: id as ActivityEventId, refs }],
      });
    };
    send('start-1', 'started');
    send('start-2', 'started');
    expect(state.graph?.nodes[0]).toMatchObject({ status: 'active', inFlight: 1 });
    send('complete-1', 'completed');
    send('complete-2', 'completed');
    expect(state.graph?.nodes[0]).toMatchObject({ status: 'idle', inFlight: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a graph snapshot and applies a batch to known nodes and edges', () => {
    const loaded = workflowReducer(initialWorkflowState, { type: 'graph', graph });
    const state = workflowReducer(loaded, {
      type: 'activity',
      now: 1000,
      events: [event('chat', 'started', 'chat-router'), event('chat', 'progress')],
    });
    expect(state.graph?.nodes[0]).toMatchObject({ status: 'active', inFlight: 1, calls24h: 3 });
    expect(state.pulses.chat).toBe(2200);
    expect(state.activeEdges['chat-router']).toBe(2200);
    expect(state.edgeAnimations).toEqual([
      { eventId: 'started-chat-chat-router', edgeId: 'chat-router', startAt: 1000, endAt: 2200 },
    ]);
    expect(state.events).toHaveLength(2);
  });

  it('queues one 1.2-second movement per edge event and expires completed dots', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const loaded = workflowReducer(initialWorkflowState, { type: 'graph', graph });
    const now = Date.now();
    const queued = workflowReducer(loaded, {
      type: 'activity',
      now,
      events: [event('chat', 'started', 'chat-router'), event('chat', 'progress', 'chat-router')],
    });
    expect(queued.edgeAnimations).toEqual([
      { eventId: 'started-chat-chat-router', edgeId: 'chat-router', startAt: now, endAt: now + 1200 },
      { eventId: 'progress-chat-chat-router', edgeId: 'chat-router', startAt: now + 1200, endAt: now + 2400 },
    ]);
    vi.advanceTimersByTime(1200);
    const afterFirst = workflowReducer(queued, { type: 'expire', now: Date.now() });
    expect(afterFirst.edgeAnimations).toEqual([queued.edgeAnimations[1]]);
    expect(afterFirst.activeEdges['chat-router']).toBe(now + 2400);
    vi.advanceTimersByTime(1200);
    const finished = workflowReducer(afterFirst, { type: 'expire', now: Date.now() });
    expect(finished.edgeAnimations).toEqual([]);
    expect(finished.activeEdges).toEqual({});
  });

  it('clears project-scoped pulses, edge animations, and activity when changing projects', () => {
    const loaded = workflowReducer(initialWorkflowState, { type: 'graph', graph });
    const active = workflowReducer(loaded, {
      type: 'activity',
      now: 1000,
      events: [event('chat', 'started', 'chat-router')],
    });
    const otherProject: WorkflowGraph = {
      ...graph,
      projectId: '00000000-0000-4000-8000-000000000003' as NonNullable<WorkflowGraph['projectId']>,
    };

    const switched = workflowReducer(active, { type: 'graph', graph: otherProject });

    expect(switched.graph).toBe(otherProject);
    expect(switched.pulses).toEqual({});
    expect(switched.activeEdges).toEqual({});
    expect(switched.edgeAnimations).toEqual([]);
    expect(switched.events).toEqual([]);
  });

  it('ignores unknown modules and empty activity batches', () => {
    const loaded = workflowReducer(initialWorkflowState, { type: 'graph', graph });
    expect(workflowReducer(loaded, { type: 'activity', now: 0, events: [] })).toBe(loaded);
    expect(workflowReducer(loaded, { type: 'activity', now: 0, events: [event('router', 'started')] })).toBe(loaded);
    expect(
      workflowReducer(initialWorkflowState, { type: 'activity', now: 0, events: [event('chat', 'started')] }),
    ).toBe(initialWorkflowState);
  });

  it('ignores activity for a different project while retaining aggregate activity support', () => {
    const projectId = '00000000-0000-4000-8000-000000000003' as NonNullable<WorkflowGraph['projectId']>;
    const loaded = workflowReducer(initialWorkflowState, { type: 'graph', graph: { ...graph, projectId } });
    expect(
      workflowReducer(loaded, { type: 'activity', now: 0, events: [event('chat', 'started', 'chat-router')] }),
    ).toBe(loaded);
    const aggregate = workflowReducer(initialWorkflowState, { type: 'graph', graph });
    const state = workflowReducer(aggregate, {
      type: 'activity',
      now: 0,
      events: [{ ...event('chat', 'started'), projectId }],
    });
    expect(state.graph?.nodes[0]).toMatchObject({ status: 'active', inFlight: 1 });
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

  it('keeps a node active when one concurrent call completes and another remains in flight', () => {
    const loaded = workflowReducer(initialWorkflowState, {
      type: 'graph',
      graph: { ...graph, nodes: [{ ...chat, status: 'active', inFlight: 2 }] },
    });
    const completed = workflowReducer(loaded, { type: 'activity', now: 0, events: [event('chat', 'completed')] });
    expect(completed.graph?.nodes[0]).toMatchObject({ status: 'active', inFlight: 1 });
  });

  it('expires pulses and edges when their deadline passes and preserves state otherwise', () => {
    const active = workflowReducer(workflowReducer(initialWorkflowState, { type: 'graph', graph }), {
      type: 'activity',
      now: 0,
      events: [event('chat', 'started', 'chat-router')],
    });
    expect(workflowReducer(active, { type: 'expire', now: 1199 })).toBe(active);
    const expired = workflowReducer(active, { type: 'expire', now: 1200 });
    expect(expired.pulses).toEqual({});
    expect(expired.activeEdges).toEqual({});
    expect(expired.edgeAnimations).toEqual([]);
  });
});
