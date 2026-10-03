import type { ActivityEvent, WorkflowGraph } from '@itstudio/schemas';

export interface WorkflowState {
  readonly graph: WorkflowGraph | null;
  readonly pulses: Readonly<Record<string, number>>;
  readonly activeEdges: Readonly<Record<string, number>>;
  readonly events: readonly ActivityEvent[];
}

export type WorkflowAction =
  | { readonly type: 'graph'; readonly graph: WorkflowGraph }
  | { readonly type: 'activity'; readonly events: readonly ActivityEvent[]; readonly now: number }
  | { readonly type: 'expire'; readonly now: number };

export const initialWorkflowState: WorkflowState = { graph: null, pulses: {}, activeEdges: {}, events: [] };
const PULSE_MS = 1500;
const MAX_EVENTS = 500;

export function workflowReducer(state: WorkflowState, action: WorkflowAction): WorkflowState {
  if (action.type === 'graph') return { ...state, graph: action.graph };
  if (action.type === 'expire') {
    const pulses = Object.fromEntries(Object.entries(state.pulses).filter(([, until]) => until > action.now));
    const activeEdges = Object.fromEntries(Object.entries(state.activeEdges).filter(([, until]) => until > action.now));
    if (
      Object.keys(pulses).length === Object.keys(state.pulses).length &&
      Object.keys(activeEdges).length === Object.keys(state.activeEdges).length
    )
      return state;
    return { ...state, pulses, activeEdges };
  }
  if (action.events.length === 0) return state;
  if (state.graph === null) return state;

  const modules = new Map(state.graph.nodes.map((node) => [node.id, node]));
  const pulses = { ...state.pulses };
  const activeEdges = { ...state.activeEdges };
  const knownEvents: ActivityEvent[] = [];
  for (const event of action.events) {
    const node = modules.get(event.moduleId);
    if (node === undefined) continue;
    knownEvents.push(event);
    pulses[event.moduleId] = action.now + PULSE_MS;
    if (event.edgeId !== undefined) activeEdges[event.edgeId] = action.now + PULSE_MS;
    const terminal = event.kind === 'completed' || event.kind === 'failed';
    modules.set(event.moduleId, {
      ...node,
      status: event.kind === 'info' ? node.status : event.kind === 'failed' ? 'error' : terminal ? 'idle' : 'active',
      inFlight: Math.max(0, node.inFlight + (event.kind === 'started' ? 1 : terminal ? -1 : 0)),
      calls24h: node.calls24h + (event.kind === 'started' ? 1 : 0),
      errors24h: node.errors24h + (event.kind === 'failed' ? 1 : 0),
    });
  }
  if (knownEvents.length === 0) return state;
  const graph = { ...state.graph, nodes: [...modules.values()] };
  return { graph, pulses, activeEdges, events: [...knownEvents, ...state.events].slice(0, MAX_EVENTS) };
}
