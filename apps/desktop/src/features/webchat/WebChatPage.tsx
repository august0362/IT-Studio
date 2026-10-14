import type { AppError, WebChatLayout, WebChatSettings } from '@itstudio/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorPanel } from '../../components/ErrorPanel';
import { useRpcQuery } from '../../hooks/use-rpc-query';
import { RpcCallError } from '../../rpc/rpc-client';
import { useRpcClient } from '../../rpc/rpc-context';
import { createWebChatHost, type IWebChatHost } from './webchat-host';
import { initialLayout, MIN_PANE_SIZE, resizePanes, withPaneCount } from './webchat-layout';
import { useNativeWebChatPanes } from './use-native-webchat-panes';
import { WebChatPane } from './WebChatPane';

const SIGN_IN_WARNING_KEY = 'itstudio.webchat.sign-in-warning-dismissed';

function showSignInWarning(): boolean {
  try {
    return localStorage.getItem(SIGN_IN_WARNING_KEY) !== '1';
  } catch {
    return true;
  }
}

interface WebChatPageProps {
  readonly host?: IWebChatHost;
  readonly suspended?: boolean;
  readonly layoutRevision?: string;
  readonly onSettings?: () => void;
}

export function WebChatPage({
  host: providedHost,
  suspended = false,
  layoutRevision = '',
  onSettings,
}: WebChatPageProps) {
  const { t } = useTranslation();
  const settings = useRpcQuery('settings.get', {});
  const host = useMemo(() => providedHost ?? createWebChatHost(), [providedHost]);
  if (settings.error) return <ErrorPanel error={settings.error.appError} />;
  if (!settings.data) return <p role="status">{t('settings.loading')}</p>;
  return (
    <WebChatWorkspace
      host={host}
      initial={settings.data.webChat}
      layoutRevision={layoutRevision}
      key={JSON.stringify(settings.data.webChat.links)}
      suspended={suspended}
      onSettings={onSettings}
    />
  );
}

interface WorkspaceProps {
  readonly host: IWebChatHost;
  readonly initial: WebChatSettings;
  readonly suspended: boolean;
  readonly layoutRevision: string;
  readonly onSettings: (() => void) | undefined;
}

interface DragSession {
  readonly divider: number;
  readonly x: number;
  readonly width: number;
  readonly start: WebChatLayout;
}

function WebChatWorkspace({ host, initial, suspended, layoutRevision, onSettings }: WorkspaceProps) {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const cache = useQueryClient();
  const [layout, setLayout] = useState(() => initialLayout(initial.links, initial.layout));
  const layoutRef = useRef(layout);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [warning, setWarning] = useState(showSignInWarning);
  const [drag, setDrag] = useState<DragSession | null>(null);
  const elements = useRef<(HTMLDivElement | null)[]>([]);
  const container = useRef<HTMLDivElement>(null);
  const links = useMemo(() => initial.links.filter((link) => link.enabled), [initial.links]);
  const nativeError = useCallback((): void => {
    setError({
      code: 'INTERNAL',
      message: t('webChat.nativeError'),
      retryable: true,
      remediation: [t('webChat.useBrowser')],
    });
  }, [t]);
  useNativeWebChatPanes({
    host,
    links: initial.links,
    layout,
    elements,
    paused: suspended || drag !== null,
    measureRevision: `${String(warning)}:${String(error !== null)}:${layoutRevision}`,
    onError: nativeError,
  });

  const replaceLayout = useCallback((next: WebChatLayout): void => {
    layoutRef.current = next;
    setLayout(next);
  }, []);

  const persist = useCallback(
    async (next: WebChatLayout, previous = layoutRef.current): Promise<void> => {
      replaceLayout(next);
      setSaving(true);
      setError(null);
      try {
        const saved = await rpc.call('settings.update', { patch: { webChat: { layout: next } } });
        cache.setQueryData(['settings.get', {}], saved);
      } catch (cause: unknown) {
        replaceLayout(previous);
        setError(
          cause instanceof RpcCallError
            ? cause.appError
            : {
                code: 'INTERNAL',
                message: t('webChat.saveError'),
                retryable: true,
                remediation: [t('settings.retry')],
              },
        );
      } finally {
        setSaving(false);
      }
    },
    [cache, replaceLayout, rpc, t],
  );

  useEffect(() => {
    if (!drag) return;
    function move(event: PointerEvent): void {
      if (!drag) return;
      replaceLayout(resizePanes(drag.start, drag.divider, (event.clientX - drag.x) / drag.width));
    }
    function finish(): void {
      setDrag(null);
      if (drag) void persist(layoutRef.current, drag.start);
    }
    function cancel(): void {
      if (drag) replaceLayout(drag.start);
      setDrag(null);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', cancel, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [drag, persist, replaceLayout]);

  async function openBrowser(slot: number): Promise<void> {
    const linkId = layout.panes[slot];
    if (!linkId) return;
    try {
      await rpc.call('webchat.open', { linkId });
    } catch (cause: unknown) {
      setError(
        cause instanceof RpcCallError
          ? cause.appError
          : {
              code: 'INTERNAL',
              message: t('chat.webChat.openError'),
              retryable: true,
              remediation: [t('settings.retry')],
            },
      );
    }
  }

  return (
    <section aria-labelledby="webchat-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold" id="webchat-heading">
          {t('nav.webChat')}
        </h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2">
            {t('webChat.paneCount')}
            <select
              className="rounded border border-border bg-surface px-3 py-2"
              disabled={saving || suspended || links.length === 0}
              value={layout.panes.length}
              onChange={(event) => {
                void persist(withPaneCount(layout, links, Number(event.target.value)));
              }}
            >
              {[1, 2, 3, 4].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          {onSettings ? (
            <button className="rounded border border-border px-3 py-2" onClick={onSettings} type="button">
              {t('chat.webChat.editLinks')}
            </button>
          ) : null}
        </div>
      </div>
      {warning ? (
        <div className="flex items-start gap-3 rounded border border-warning bg-surface p-3" role="status">
          <p className="flex-1 text-sm">{t('webChat.signInWarning')}</p>
          <button
            className="rounded border border-border px-2 py-1"
            onClick={() => {
              setWarning(false);
              try {
                localStorage.setItem(SIGN_IN_WARNING_KEY, '1');
              } catch {
                /* The warning stays dismissed for this session. */
              }
            }}
            type="button"
          >
            {t('webChat.dismiss')}
          </button>
        </div>
      ) : null}
      {error ? <ErrorPanel error={error} /> : null}
      {links.length === 0 ? (
        <p role="status">{t('webChat.noSites')}</p>
      ) : (
        <div ref={container} className="flex h-[65vh] min-h-80 w-full gap-1" aria-label={t('webChat.panes')}>
          {layout.panes.map((linkId, slot) => (
            <Fragment key={slot}>
              {slot > 0 ? (
                <div
                  aria-label={t('webChat.resize', { left: slot, right: slot + 1 })}
                  aria-orientation="vertical"
                  aria-valuemin={MIN_PANE_SIZE * 100}
                  aria-valuemax={Math.round(
                    ((layout.sizes[slot - 1] ?? 0) + (layout.sizes[slot] ?? 0) - MIN_PANE_SIZE) * 100,
                  )}
                  aria-valuenow={Math.round((layout.sizes[slot - 1] ?? 0) * 100)}
                  className="w-2 shrink-0 cursor-col-resize rounded bg-border hover:bg-primary focus-visible:outline-2 focus-visible:outline-focus-ring"
                  onKeyDown={(event) => {
                    if (saving || suspended || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
                    event.preventDefault();
                    void persist(resizePanes(layout, slot - 1, event.key === 'ArrowRight' ? 0.05 : -0.05));
                  }}
                  onPointerDown={(event) => {
                    if (saving || suspended) return;
                    event.preventDefault();
                    const width = container.current?.getBoundingClientRect().width;
                    if (width) setDrag({ divider: slot - 1, x: event.clientX, width, start: layout });
                  }}
                  role="separator"
                  tabIndex={0}
                />
              ) : null}
              <div className="min-w-0" style={{ flex: `${String(layout.sizes[slot] ?? 1)} 1 0%` }}>
                <WebChatPane
                  contentRef={(element) => {
                    elements.current[slot] = element;
                  }}
                  disabled={saving || suspended || drag !== null}
                  linkId={linkId}
                  links={links}
                  nativeAvailable={host.available}
                  onOpen={() => void openBrowser(slot)}
                  onReload={() => void host.reload(slot).catch(nativeError)}
                  onSelect={(selected) => {
                    void persist({
                      ...layout,
                      panes: layout.panes.map((id, index) => (index === slot ? selected : id)),
                    });
                  }}
                  slot={slot}
                />
              </div>
            </Fragment>
          ))}
        </div>
      )}
    </section>
  );
}
