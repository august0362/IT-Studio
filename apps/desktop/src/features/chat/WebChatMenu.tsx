import type { ProjectId, WebChatLink } from '@itstudio/schemas';
import type { JSX, KeyboardEvent } from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRpcQuery } from '../../hooks/use-rpc-query';
import { useRpcClient } from '../../rpc/rpc-context';

export function WebChatMenu({
  projectId,
  onEdit,
}: {
  readonly projectId: ProjectId | null;
  readonly onEdit: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const settings = useRpcQuery('settings.get', {});
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState('');
  const enabled = (settings.data?.webChat.links ?? []).filter((link) => link.enabled);
  const focusItem = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setOpen(true);
    const position = event.key === 'ArrowDown' ? 'first' : 'last';
    requestAnimationFrame(() => {
      focusMenuItem(position);
    });
  };
  async function openLink(link: WebChatLink): Promise<void> {
    try {
      const result = await rpc.call('webchat.open', { linkId: link.id });
      setToast(t('chat.webChat.opened', { browser: t(`chat.webChat.browser.${result.browser}`) }));
      setOpen(false);
      trigger.current?.focus();
    } catch {
      setToast(t('chat.webChat.openError'));
    }
  }
  async function copyBrief(): Promise<void> {
    if (projectId === null) return;
    try {
      const brief = await rpc.call('webchat.projectBrief', { projectId });
      await navigator.clipboard.writeText(brief.text);
      setToast(t('chat.webChat.copied'));
    } catch {
      setToast(t('chat.webChat.copyError'));
    }
  }
  return (
    <div className="relative">
      <button
        ref={trigger}
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded border border-border px-3 py-2 hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-focus-ring"
        onClick={() => {
          setOpen((value) => !value);
        }}
        onKeyDown={focusItem}
        type="button"
      >
        {t('chat.webChat.label')}
      </button>
      {open ? (
        <div
          aria-label={t('chat.webChat.label')}
          className="absolute right-0 z-20 mt-1 min-w-64 rounded border border-border bg-surface p-1 shadow-lg"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false);
              trigger.current?.focus();
              return;
            }
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
            const current = items.findIndex((item) => item === document.activeElement);
            const offset = event.key === 'ArrowDown' ? 1 : -1;
            const target = current < 0 ? 0 : (current + offset + items.length) % items.length;
            items[target]?.focus();
          }}
          role="menu"
        >
          {enabled.map((link) => (
            <button
              className="block w-full rounded px-3 py-2 text-left hover:bg-surface-alt"
              key={link.id}
              onClick={() => void openLink(link)}
              role="menuitem"
              type="button"
            >
              {link.name}
              <span className="ml-2 text-xs text-text-muted">{host(link.url)}</span>
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <button
            className="block w-full rounded px-3 py-2 text-left hover:bg-surface-alt disabled:opacity-50"
            disabled={projectId === null}
            onClick={() => void copyBrief()}
            role="menuitem"
            type="button"
          >
            {t('chat.webChat.copyBrief')}
          </button>
          <button
            className="block w-full rounded px-3 py-2 text-left hover:bg-surface-alt"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            role="menuitem"
            type="button"
          >
            {t('chat.webChat.editLinks')}
          </button>
        </div>
      ) : null}
      {toast ? (
        <span className="sr-only" role="status">
          {toast}
        </span>
      ) : null}
    </div>
  );
}

function focusMenuItem(position: 'first' | 'last'): void {
  const items = document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
  (position === 'first' ? items[0] : items[items.length - 1])?.focus();
}

function host(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}
