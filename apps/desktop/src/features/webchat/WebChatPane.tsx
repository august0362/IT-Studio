import type { WebChatLink, WebChatLinkId } from '@itstudio/schemas';
import { useTranslation } from 'react-i18next';

interface WebChatPaneProps {
  readonly slot: number;
  readonly linkId: WebChatLinkId;
  readonly links: readonly WebChatLink[];
  readonly nativeAvailable: boolean;
  readonly disabled: boolean;
  readonly contentRef: (element: HTMLDivElement | null) => void;
  readonly onSelect: (linkId: WebChatLinkId) => void;
  readonly onReload: () => void;
  readonly onOpen: () => void;
}

export function WebChatPane({
  slot,
  linkId,
  links,
  nativeAvailable,
  disabled,
  contentRef,
  onSelect,
  onReload,
  onOpen,
}: WebChatPaneProps) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t('webChat.pane', { number: slot + 1 })}
      className="flex h-full min-w-0 flex-col overflow-hidden rounded border border-border bg-surface"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t('webChat.site', { number: slot + 1 })}</span>
          <select
            className="w-full rounded border border-border bg-bg p-2"
            disabled={disabled}
            value={linkId}
            onChange={(event) => {
              const selected = links.find((link) => link.id === event.target.value);
              if (selected) onSelect(selected.id);
            }}
          >
            {links.map((link) => (
              <option key={link.id} value={link.id}>
                {link.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="rounded border border-border px-2 py-2 disabled:opacity-50"
          disabled={disabled || !nativeAvailable}
          onClick={onReload}
          type="button"
        >
          {t('webChat.reload')}
        </button>
        <button
          className="rounded border border-border px-2 py-2 disabled:opacity-50"
          disabled={disabled}
          onClick={onOpen}
          type="button"
        >
          {t('webChat.openInBrowser')}
        </button>
      </div>
      <div ref={contentRef} className="min-h-0 flex-1 bg-bg" data-webchat-content={slot}>
        {!nativeAvailable ? <p className="p-4 text-sm text-text-muted">{t('webChat.desktopOnly')}</p> : null}
      </div>
    </section>
  );
}
