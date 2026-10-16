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

export function WebChatFloatingWindow(props: Props) {
  const link = props.links.find((item) => item.id === props.window.linkId);
  const frame = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const pointer = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  if (!link || props.minimized) return null;
  const bounds = frame.current?.parentElement?.getBoundingClientRect();
  const x = Math.max(0, Math.min((bounds?.width ?? 32768) - props.window.width, preview?.x ?? props.window.x));
  const y = Math.max(0, Math.min((bounds?.height ?? 32768) - 42, preview?.y ?? props.window.y));
  function finish(): void {
    const current = pointer.current;
    if (!current) return;
    const rect = frame.current?.parentElement?.getBoundingClientRect();
    const width = rect?.width ?? 800;
    const height = rect?.height ?? 500;
    props.onChange({
      ...props.window,
      x: Math.max(0, Math.min(width - props.window.width, x)),
      y: Math.max(0, Math.min(height - 42, y)),
      maximized: false,
    });
    pointer.current = null;
    setMoving(false);
    props.onDragEnd();
  }
  return (
    <section
      ref={frame}
      aria-label={link.name}
      className="absolute flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl transition-[left,top,width,height] duration-200 motion-reduce:transition-none"
      style={{ left: x, top: y, width: props.window.width, height: props.window.height, zIndex: props.window.zIndex }}
      onPointerDown={props.onRaise}
      onKeyDown={(event) => {
        if (!event.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const dx = event.key === 'ArrowLeft' ? -24 : event.key === 'ArrowRight' ? 24 : 0;
        const dy = event.key === 'ArrowUp' ? -24 : event.key === 'ArrowDown' ? 24 : 0;
        props.onChange({
          ...props.window,
          x: Math.max(
            0,
            Math.min((bounds?.width ?? 32768) - props.window.width, props.window.x + (event.shiftKey ? 0 : dx)),
          ),
          y: Math.max(0, Math.min((bounds?.height ?? 32768) - 42, props.window.y + (event.shiftKey ? 0 : dy))),
          width: Math.max(360, props.window.width + (event.shiftKey ? dx : 0)),
          height: Math.max(280, props.window.height + (event.shiftKey ? dy : 0)),
        });
      }}
    >
      <div
        className="flex h-10 shrink-0 cursor-move items-center gap-2 border-b border-border bg-surface px-2"
        tabIndex={0}
        role="group"
        aria-label={link.name}
        onDoubleClick={props.onMaximize}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target instanceof HTMLElement && event.target.closest('button'))) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointer.current = { x: event.clientX, y: event.clientY, originX: x, originY: y };
          setMoving(true);
          props.onDragStart();
        }}
        onPointerMove={(event) => {
          const current = pointer.current;
          if (current)
            setPreview({
              x: current.originX + event.clientX - current.x,
              y: current.originY + event.clientY - current.y,
            });
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
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
      <div className="relative min-h-0 flex-1">
        <div className="min-h-0 h-full" style={{ visibility: moving ? 'hidden' : 'visible' }}>
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
