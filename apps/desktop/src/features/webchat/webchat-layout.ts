import type { WebChatLayout, WebChatLink } from '@itstudio/schemas';

export const MIN_PANE_SIZE = 0.1;

export function initialLayout(links: readonly WebChatLink[], saved: WebChatLayout | undefined): WebChatLayout {
  const enabled = links.filter((link) => link.enabled);
  if (saved?.panes.every((id) => enabled.some((link) => link.id === id))) return saved;
  return { panes: enabled.slice(0, 1).map((link) => link.id), sizes: enabled.length > 0 ? [1] : [] };
}

export function withPaneCount(layout: WebChatLayout, links: readonly WebChatLink[], count: number): WebChatLayout {
  const enabled = links.filter((link) => link.enabled);
  const first = enabled[0];
  if (!first) return { panes: [], sizes: [] };
  const panes = Array.from({ length: count }, (_, index) => layout.panes[index] ?? enabled[index]?.id ?? first.id);
  return { panes, sizes: panes.map(() => 1 / panes.length) };
}

export function resizePanes(layout: WebChatLayout, divider: number, change: number): WebChatLayout {
  const left = layout.sizes[divider];
  const right = layout.sizes[divider + 1];
  if (left === undefined || right === undefined) return layout;
  const applied = Math.max(MIN_PANE_SIZE - left, Math.min(right - MIN_PANE_SIZE, change));
  return {
    ...layout,
    sizes: layout.sizes.map((size, index) =>
      index === divider ? size + applied : index === divider + 1 ? size - applied : size,
    ),
  };
}
