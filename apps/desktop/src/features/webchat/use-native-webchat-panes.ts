import type { WebChatLayout, WebChatLink, WebChatLinkId, WebChatPaneRequest } from '@itstudio/schemas';
import { useEffect, type RefObject } from 'react';
import type { IWebChatHost } from './webchat-host';

interface NativePaneOptions {
  readonly host: IWebChatHost;
  readonly links: readonly WebChatLink[];
  readonly layout: WebChatLayout;
  readonly elements: RefObject<readonly (HTMLDivElement | null)[]>;
  readonly paused: boolean;
  readonly measureRevision: string;
  readonly onError: () => void;
  readonly onLoadFailure: (linkIds: readonly WebChatLinkId[]) => void;
}

export function useNativeWebChatPanes({
  host,
  links,
  layout,
  elements,
  paused,
  measureRevision,
  onError,
  onLoadFailure,
}: NativePaneOptions): void {
  useEffect(() => {
    return () => {
      void host.closeAll().catch(() => {
        console.warn('Embedded web chat panes could not be closed.');
      });
    };
  }, [host]);

  useEffect(() => {
    if (!host.available) return;
    if (paused) {
      void host.setVisible(false).catch(onError);
      return;
    }
    let active = true;
    let frame = 0;
    function schedule(): void {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (!active) return;
        const panes: WebChatPaneRequest[] = [];
        layout.panes.forEach((linkId, slot) => {
          const element = elements.current[slot];
          if (!element) return;
          const rect = element.getBoundingClientRect();
          const clip = element.closest('main')?.getBoundingClientRect();
          const x = Math.max(0, rect.left, clip?.left ?? 0);
          const y = Math.max(0, rect.top, clip?.top ?? 0);
          const right = Math.min(window.innerWidth, rect.right, clip?.right ?? window.innerWidth);
          const bottom = Math.min(window.innerHeight, rect.bottom, clip?.bottom ?? window.innerHeight);
          if (right <= x || bottom <= y) return;
          panes.push({ slot, linkId, bounds: { x, y, width: right - x, height: bottom - y } });
        });
        void host
          .sync(
            links,
            panes,
            layout.panes.map((_, slot) => slot),
          )
          .then(() => {
            if (active) {
              return host.setVisible(true);
            }
          })
          .catch(() => {
            if (active) {
              onLoadFailure(panes.map((pane) => pane.linkId));
              onError();
            }
          });
      });
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    elements.current.forEach((element) => {
      if (!element) return;
      observer?.observe(element);
      const scrollContainer = element.closest('main');
      if (scrollContainer) observer?.observe(scrollContainer);
      const workspace = element.closest('[aria-labelledby="webchat-heading"]');
      if (workspace) observer?.observe(workspace);
    });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    schedule();
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [elements, host, layout, links, measureRevision, onError, onLoadFailure, paused]);
}
