import type { ActivityEvent, WorkflowGraph } from '@itstudio/schemas';
import { activityReference, mergeActivity, openActivity, reconcileAnonymousActivity } from './activity';

export interface WorkflowState {
  readonly graph: WorkflowGraph | null;
  readonly pulses: Readonly<Record<string, number>>;
  readonly activeEdges: Readonly<Record<string, number>>;
  readonly edgeAnimations: readonly WorkflowEdgeAnimation[];
  readonly events: readonly ActivityEvent[];
}

export interface WorkflowEdgeAnimation {
  readonly eventId: ActivityEvent['id'];
  readonly edgeId: string;
  readonly startAt: number;
  readonly endAt: number;
}

export type WorkflowAction =
  | { readonly type: 'graph'; readonly graph: WorkflowGraph }
  | {
      readonly type: 'history';
      readonly projectId: WorkflowGraph['projectId'];
      readonly events: readonly ActivityEvent[];
    }
  | { readonly type: 'activity'; readonly events: readonly ActivityEvent[]; readonly now: number }
  | { readonly type: 'expire'; readonly now: number };

export const initialWorkflowState: WorkflowState = {
  graph: null,
  pulses: {},
  activeEdges: {},
  edgeAnimations: [],
  events: [],
};
const PULSE_MS = 1200;
const MAX_EVENTS = 500;

export function workflowReducer(state: WorkflowState, action: WorkflowAction): WorkflowState {
  if (action.type === 'graph') {
    if (state.graph !== null && state.graph.projectId !== action.graph.projectId) {
      return { graph: action.graph, pulses: {}, activeEdges: {}, edgeAnimations: [], events: [] };
    }
    return { ...state, graph: reconcileAnonymousActivity(action.graph, state.events) };
  }
  if (action.type === 'history') {
    if (state.graph?.projectId !== action.projectId) return state;
    const events = mergeActivity([...state.events, ...action.events]).slice(0, MAX_EVENTS);
    return { ...state, events, graph: reconcileAnonymousActivity(state.graph, events) };
  }
  if (action.type === 'expire') {
    const pulses = Object.fromEntries(Object.entries(state.pulses).filter(([, until]) => until > action.now));
    const edgeAnimations = state.edgeAnimations.filter((animation) => animation.endAt > action.now);
    const activeEdges: Record<string, number> = {};
    for (const animation of edgeAnimations) {
      activeEdges[animation.edgeId] = Math.max(activeEdges[animation.edgeId] ?? 0, animation.endAt);
    }
    if (
      Object.keys(pulses).length === Object.keys(state.pulses).length &&
      edgeAnimations.length === state.edgeAnimations.length &&
      Object.keys(activeEdges).length === Object.keys(state.activeEdges).length
    )
      return state;
    return { ...state, pulses, activeEdges, edgeAnimations };
  }
  if (action.events.length === 0) return state;
  if (state.graph === null) return state;

  const modules = new Map(state.graph.nodes.map((node) => [node.id, node]));
  const pulses = { ...state.pulses };
  const activeEdges = { ...state.activeEdges };
  const edgeAnimations = [...state.edgeAnimations];
  const knownEdges = new Set(state.graph.edges.map((edge) => edge.id));
  const knownEvents: ActivityEvent[] = [];
  for (const event of action.events) {
    if (state.events.some((known) => known.id === event.id) || knownEvents.some((known) => known.id === event.id))
      continue;
    if (state.graph.projectId !== null && event.projectId !== state.graph.projectId) continue;
    const node = modules.get(event.moduleId);
    if (node === undefined) continue;
    knownEvents.push(event);
    pulses[event.moduleId] = action.now + PULSE_MS;
    if (event.edgeId !== undefined && knownEdges.has(event.edgeId)) {
      const alreadyQueued = edgeAnimations.some((animation) => animation.eventId === event.id);
      if (!alreadyQueued) {
        const priorEnd = edgeAnimations
          .filter((animation) => animation.edgeId === event.edgeId)
          .reduce((endAt, animation) => Math.max(endAt, animation.endAt), action.now);
        const startAt = Math.max(action.now, priorEnd);
        const endAt = startAt + PULSE_MS;
        edgeAnimations.push({ eventId: event.id, edgeId: event.edgeId, startAt, endAt });
        activeEdges[event.edgeId] = endAt;
      }
    }
    const terminal = event.kind === 'completed' || event.kind === 'failed';
    const ref = activityReference(event);
    const prior = [...knownEvents.slice(0, -1)]
      .reverse()
      .concat(state.events)
      .filter(
        (candidate) =>
          candidate.moduleId === event.moduleId &&
          candidate.projectId === event.projectId &&
          activityReference(candidate) === ref,
      );
    const alreadyOpen = ref !== undefined && openActivity(prior).length > 0;
    const alreadyClosed = ref !== undefined && prior.some((candidate) => candidate.kind !== 'info') && !alreadyOpen;
    const started = event.kind === 'started' && !alreadyOpen;
    const inFlight = Math.max(0, node.inFlight + (started ? 1 : terminal && !alreadyClosed ? -1 : 0));
    modules.set(event.moduleId, {
      ...node,
      status:
        event.kind === 'info'
          ? node.status
          : event.kind === 'failed'
            ? 'error'
            : terminal && inFlight === 0
              ? 'idle'
              : inFlight > 0
                ? 'active'
                : 'idle',
      inFlight,
      calls24h: node.calls24h + (started ? 1 : 0),
      errors24h: node.errors24h + (event.kind === 'failed' ? 1 : 0),
    });
  }
  if (knownEvents.length === 0) return state;
  const events = mergeActivity([...knownEvents].reverse().concat(state.events)).slice(0, MAX_EVENTS);
  const graph = reconcileAnonymousActivity({ ...state.graph, nodes: [...modules.values()] }, events);
  return { graph, pulses, activeEdges, edgeAnimations, events };
}
