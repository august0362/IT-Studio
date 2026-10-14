import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { WorkflowEdgeAnimation } from './workflow-store';

export interface ActivityEdgeData extends Record<string, unknown> {
  readonly animations: readonly WorkflowEdgeAnimation[];
  readonly reducedMotion: boolean;
}

export type ActivityFlowEdge = Edge<ActivityEdgeData, 'activity'>;

function MovingDot({
  animation,
  path,
}: {
  readonly animation: WorkflowEdgeAnimation;
  readonly path: string;
}): JSX.Element {
  const [started, setStarted] = useState(() => animation.startAt <= Date.now());
  const motion = useRef<SVGAnimateMotionElement>(null);

  useEffect(() => {
    const element = motion.current;
    const delay = Math.max(0, animation.startAt - Date.now());
    const timer = window.setTimeout(() => {
      if (element !== null && typeof element.beginElement === 'function') element.beginElement();
      setStarted(true);
    }, delay);
    return () => {
      window.clearTimeout(timer);
    };
  }, [animation.startAt]);

  return (
    <circle
      aria-hidden="true"
      className="workflow-edge-dot"
      cx="0"
      cy="0"
      data-event-id={animation.eventId}
      data-start-at={animation.startAt}
      data-testid="workflow-edge-dot"
      fill="var(--color-primary)"
      r="4"
      style={{ visibility: started ? 'visible' : 'hidden' }}
    >
      <animateMotion begin="indefinite" dur="1200ms" fill="freeze" path={path} ref={motion} />
    </circle>
  );
}

export function ActivityEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
  label,
  data,
}: EdgeProps<ActivityFlowEdge>): JSX.Element {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });
  const animations = data?.reducedMotion === true ? [] : (data?.animations ?? []);

  return (
    <>
      <BaseEdge id={id} path={path} style={style} {...(markerEnd === undefined ? {} : { markerEnd })} />
      {label === undefined || label === null ? null : (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-text"
            style={{
              transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)`,
              pointerEvents: 'none',
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
      {animations.map((animation) => (
        <MovingDot animation={animation} key={animation.eventId} path={path} />
      ))}
    </>
  );
}
