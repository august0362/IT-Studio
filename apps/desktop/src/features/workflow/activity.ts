import type { ActivityEvent, WorkflowGraph } from '@itstudio/schemas';

export function activityReference(event: ActivityEvent): string | undefined {
  return (
    event.refs.requestId ??
    event.refs.pipelineRunId ??
    event.refs.ingestJobId ??
    event.refs.commandRunId ??
    event.refs.transactionId ??
    event.refs.conversationId
  );
}

export function mergeActivity(events: readonly ActivityEvent[]): readonly ActivityEvent[] {
  return [...new Map(events.map((event) => [event.id, event])).values()].sort(
    (left, right) => Date.parse(right.ts) - Date.parse(left.ts),
  );
}

/** Replay oldest first. Anonymous calls are paired FIFO within their project and module. */
export function openActivity(events: readonly ActivityEvent[]): readonly ActivityEvent[] {
  const open = new Map<string, ActivityEvent[]>();
  for (const event of [...mergeActivity(events)].reverse()) {
    const ref = activityReference(event);
    const key = JSON.stringify([event.projectId, event.moduleId, ref ?? null]);
    const items = open.get(key) ?? [];
    if (event.kind === 'started' || event.kind === 'progress') {
      if (ref !== undefined) items.splice(0, items.length, event);
      else if (event.kind === 'started') items.push(event);
      else if (items.length > 0) items[items.length - 1] = event;
    } else if (event.kind === 'completed' || event.kind === 'failed') {
      items.shift();
    }
    open.set(key, items);
  }
  return [...open.values()].flat();
}

/** Legacy recorder snapshots cannot pair anonymous completions by event id. */
export function reconcileAnonymousActivity(graph: WorkflowGraph, events: readonly ActivityEvent[]): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.status === 'disabled') return node;
      const lifecycle = events.filter(
        (event) =>
          event.moduleId === node.id &&
          (graph.projectId === null || event.projectId === graph.projectId) &&
          event.kind !== 'info',
      );
      if (
        !lifecycle.some((event) => event.kind === 'started') ||
        lifecycle.some((event) => activityReference(event) !== undefined)
      )
        return node;
      const inFlight = openActivity(lifecycle).length;
      return {
        ...node,
        inFlight,
        status: inFlight > 0 ? 'active' : lifecycle[0]?.kind === 'failed' ? 'error' : 'idle',
      };
    }),
  };
}
