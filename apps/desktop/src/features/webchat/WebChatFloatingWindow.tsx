import type { WebChatLink, WebChatLinkId, WebChatWindowLayout } from '@itstudio/schemas';
import { useRef, useState } from 'react';
import { WebChatPane } from './WebChatPane';

interface Props {
  readonly window: WebChatWindowLayout;
  readonly slot: number;
  readonly links: readonly WebChatLink[];
  readonly contentRef: (element: HTMLDivElement | null) => void;
  readonly disabled: boolean;
  readonly front: boolean;
  readonly onRaise: () => void;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onChange: (window: WebChatWindowLayout) => void;
  readonly onClose: () => void;
  readonly onReload: () => void;
  readonly onOpen: () => void;
  readonly onSelect: (linkId: WebChatLinkId) => void;
  readonly minimized: boolean;
  readonly onMinimize: () => void;
  readonly onMaximize: () => void;
}

interface Gesture {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly origin: WebChatWindowLayout;
  readonly edge: string;
}

interface GestureListeners {
  readonly move: (event: PointerEvent) => void;
  readonly finish: () => void;
  readonly cancel: (event: KeyboardEvent | PointerEvent) => void;
}

const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
const CURSORS: Record<(typeof EDGES)[number], string> = {
  n: 'cursor-n-resize',
  s: 'cursor-s-resize',
  e: 'cursor-e-resize',
  w: 'cursor-w-resize',
  ne: 'cursor-ne-resize',
  nw: 'cursor-nw-resize',
  se: 'cursor-se-resize',
  sw: 'cursor-sw-resize',
};

export function WebChatFloatingWindow(props: Props) {
  const link = props.links.find((item) => item.id === props.window.linkId);
  const frame = useRef<HTMLElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const listeners = useRef<GestureListeners | null>(null);
  const previewRef = useRef<WebChatWindowLayout | null>(null);
  const [preview, setPreview] = useState<WebChatWindowLayout | null>(null);
  const [moving, setMoving] = useState(false);
  const view = preview ?? props.window;

  function stop(commit: boolean): void {
    const active = gesture.current;
    if (!active) return;
    if (listeners.current) {
      window.removeEventListener('pointermove', listeners.current.move);
      window.removeEventListener('pointerup', listeners.current.finish);
      window.removeEventListener('pointercancel', listeners.current.cancel);
      window.removeEventListener('keydown', listeners.current.cancel);
      listeners.current = null;
    }
    gesture.current = null;
    const next = previewRef.current ?? active.origin;
    if (commit) props.onRaise();
    if (commit) props.onChange({ ...next, maximized: false });
    else {
      previewRef.current = active.origin;
      setPreview(active.origin);
    }
    if (commit) {
      previewRef.current = null;
      setPreview(null);
    }
    setMoving(false);
    props.onDragEnd();
  }

  if (!link || props.minimized) return null;

  function begin(event: React.PointerEvent<HTMLElement>, edge = ''): void {
    if (event.button !== 0 || props.disabled) return;
    event.preventDefault();
    gesture.current = { pointerX: event.clientX, pointerY: event.clientY, origin: props.window, edge };
    previewRef.current = props.window;
    setPreview(props.window);
    setMoving(true);
    props.onDragStart();
    const move = (pointerEvent: PointerEvent): void => {
      update(pointerEvent);
    };
    const finish = (): void => {
      stop(true);
    };
    const cancel = (pointerEvent: KeyboardEvent | PointerEvent): void => {
      if (pointerEvent instanceof KeyboardEvent && pointerEvent.key !== 'Escape') return;
      stop(false);
    };
    listeners.current = { move, finish, cancel };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', cancel);
  }

  function update(event: Pick<PointerEvent, 'clientX' | 'clientY'>): void {
    const active = gesture.current;
    if (!active) return;
    const dx = event.clientX - active.pointerX;
    const dy = event.clientY - active.pointerY;
    const area = frame.current?.parentElement?.getBoundingClientRect();
    const maxW = area?.width ?? 32768;
    const maxH = area?.height ?? 32768;
    let { x, y, width, height } = active.origin;
    if (!active.edge) {
      x += dx;
      y += dy;
    } else {
      if (active.edge.includes('e')) width = Math.max(360, Math.min(maxW - x, width + dx));
      if (active.edge.includes('s')) height = Math.max(280, Math.min(maxH - y, height + dy));
      if (active.edge.includes('w')) {
        const bounded = Math.max(0, Math.min(x + width - 360, x + dx));
        width += x - bounded;
        x = bounded;
      }
      if (active.edge.includes('n')) {
        const bounded = Math.max(0, Math.min(y + height - 280, y + dy));
        height += y - bounded;
        y = bounded;
      }
    }
    x = Math.max(0, Math.min(maxW - width, x));
    y = Math.max(0, Math.min(maxH - height, y));
    const next = { ...active.origin, x, y, width, height, maximized: false };
    previewRef.current = next;
    setPreview(next);
  }

  return (
    <section
      ref={frame}
      aria-label={link.name}
      className="absolute flex flex-col overflow-visible rounded-lg border border-border bg-surface shadow-xl transition-[left,top,width,height] duration-200 motion-reduce:transition-none"
      style={{ left: view.x, top: view.y, width: view.width, height: view.height, zIndex: props.window.zIndex }}
      onPointerDown={props.onRaise}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && gesture.current) {
          event.preventDefault();
          stop(false);
          return;
        }
        if (!event.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const dx = event.key === 'ArrowLeft' ? -24 : event.key === 'ArrowRight' ? 24 : 0;
        const dy = event.key === 'ArrowUp' ? -24 : event.key === 'ArrowDown' ? 24 : 0;
        const area = frame.current?.parentElement?.getBoundingClientRect();
        const bounds = { width: area?.width ?? 32768, height: area?.height ?? 32768 };
        props.onChange({
          ...props.window,
          x: Math.max(0, Math.min(bounds.width - props.window.width, props.window.x + (event.shiftKey ? 0 : dx))),
          y: Math.max(0, Math.min(bounds.height - props.window.height, props.window.y + (event.shiftKey ? 0 : dy))),
          width: Math.max(360, Math.min(bounds.width, props.window.width + (event.shiftKey ? dx : 0))),
          height: Math.max(280, Math.min(bounds.height, props.window.height + (event.shiftKey ? dy : 0))),
        });
      }}
    >
      {EDGES.map((edge) => (
        <div
          key={edge}
          aria-hidden="true"
          className={`absolute z-20 ${CURSORS[edge]} ${edge.includes('n') ? 'top-0' : edge.includes('s') ? 'bottom-0' : 'top-1/2 -translate-y-1/2'} ${edge.includes('w') ? 'left-0' : edge.includes('e') ? 'right-0' : 'left-1/2 -translate-x-1/2'} ${edge.length === 2 ? 'h-3 w-3' : edge === 'n' || edge === 's' ? 'h-1.5 w-full' : 'h-full w-1.5'}`}
          onPointerDown={(event) => {
            begin(event, edge);
          }}
        />
      ))}
      <div
        className="relative z-10 flex h-10 shrink-0 cursor-move items-center gap-2 border-b border-border bg-surface px-2"
        tabIndex={0}
        role="group"
        aria-label={link.name}
        onDoubleClick={props.onMaximize}
        onPointerDown={(event) => {
          if (event.target instanceof HTMLElement && event.target.closest('button')) return;
          begin(event);
        }}
      >
        <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded bg-bg font-semibold">
          {link.name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{link.name}</span>
        <button aria-label={`Minimize ${link.name}`} className="rounded px-2" onClick={props.onMinimize} type="button">
          −
        </button>
        <button
          aria-label={`${props.window.maximized ? 'Restore' : 'Maximize'} ${link.name}`}
          className="rounded px-2"
          onClick={props.onMaximize}
          type="button"
        >
          □
        </button>
        <button
          aria-label={`Open ${link.name} in browser`}
          className="rounded px-2 text-xs"
          onClick={props.onOpen}
          type="button"
        >
          ↗
        </button>
        <button aria-label={`Close ${link.name}`} className="rounded px-2" onClick={props.onClose} type="button">
          ×
        </button>
      </div>
      <div className="relative z-0 min-h-0 flex-1">
        <div className="h-full min-h-0" style={{ visibility: moving ? 'hidden' : 'visible' }}>
          <WebChatPane
            contentRef={props.contentRef}
            disabled={props.disabled}
            linkId={props.window.linkId}
            links={props.links}
            nativeAvailable={true}
            onOpen={props.onOpen}
            onReload={props.onReload}
            onSelect={props.onSelect}
            slot={props.slot}
          />
        </div>
        {moving ? (
          <div
            className="absolute inset-0 grid place-items-center bg-surface/80 text-sm text-text-muted backdrop-blur motion-reduce:backdrop-blur-none"
            aria-label={`${link.name} moving`}
            role="status"
          >
            <span aria-hidden="true" className="mr-2 grid h-6 w-6 place-items-center rounded bg-bg font-semibold">
              {link.name.slice(0, 1)}
            </span>
            {link.name}
          </div>
        ) : null}
      </div>
    </section>
  );
}
