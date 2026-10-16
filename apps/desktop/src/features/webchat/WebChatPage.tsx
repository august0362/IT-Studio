import type { AppError, ProjectId, WebChatLayout, WebChatSettings, WebChatWindowLayout } from '@itstudio/schemas';
import { PageHeader } from '../../components/ui/PageHeader';
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
import { WebChatFloatingWindow } from './WebChatFloatingWindow';
import { useWebChatReporting } from './useWebChatReporting';

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
  readonly projectId?: ProjectId | null;
}

export function WebChatPage({
  host: providedHost,
  suspended = false,
  layoutRevision = '',
  onSettings,
  projectId,
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
      projectId={projectId === undefined ? (settings.data.activeProjectId ?? null) : projectId}
    />
  );
}

interface WorkspaceProps {
  readonly host: IWebChatHost;
  readonly initial: WebChatSettings;
  readonly suspended: boolean;
  readonly layoutRevision: string;
  readonly onSettings: (() => void) | undefined;
  readonly projectId: ProjectId | null;
}

interface DragSession {
  readonly divider: number;
  readonly x: number;
  readonly width: number;
  readonly start: WebChatLayout;
}

function WebChatWorkspace({ host, initial, suspended, layoutRevision, onSettings, projectId }: WorkspaceProps) {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const cache = useQueryClient();
  const [layout, setLayout] = useState(() => initialLayout(initial.links, initial.layout));
  const layoutRef = useRef(layout);
  const reportFailed = useWebChatReporting(layout, host.available, projectId);
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
    onLoadFailure: reportFailed,
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

  async function openBrowser(slot: number, requestedId?: WebChatWindowLayout['linkId']): Promise<void> {
    const linkId = requestedId ?? layout.panes[slot];
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

  const freeWindows = layout.windows ?? [];
  function saveWindows(windows: readonly WebChatWindowLayout[]): void {
    const ordered = [...windows]
      .sort((left, right) => left.zIndex - right.zIndex)
      .map((item, index) => ({ ...item, zIndex: index }));
    void persist({
      ...layout,
      mode: 'free',
      windows: ordered,
    });
  }

  return (
    <section aria-labelledby="webchat-heading" className="space-y-4">
      <PageHeader
        icon="web"
        title={t('nav.webChat')}
        subtitle={t('character.webchat')}
        id="webchat-heading"
        level={2}
        action={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              Layout
              <select
                aria-label="Web chat layout"
                className="rounded border border-border bg-surface px-3 py-2"
                value={layout.mode ?? 'tiled'}
                disabled={saving || suspended}
                onChange={(event) => {
                  if (event.target.value === 'free') {
                    const windows = freeWindows.length
                      ? freeWindows
                      : layout.panes.map((linkId, index) => ({
                          linkId,
                          x: 24 + index * 34,
                          y: 24 + index * 34,
                          width: 560,
                          height: 400,
                          maximized: false,
                          minimized: false,
                          zIndex: index,
                        }));
                    saveWindows(windows);
                  } else void persist({ ...layout, mode: 'tiled' });
                }}
              >
                <option value="tiled">Tiled</option>
                <option value="free">Free</option>
              </select>
            </label>
            {layout.mode === 'free' ? (
              <label className="flex items-center gap-2">
                Add window
                <select
                  aria-label="Add web chat window"
                  value=""
                  onChange={(event) => {
                    const id = links.find((item) => item.id === event.target.value)?.id;
                    if (!id) return;
                    const found = freeWindows.find((item) => item.linkId === id);
                    if (found)
                      saveWindows(
                        freeWindows.map((item) => (item.linkId === id ? { ...item, minimized: false } : item)),
                      );
                    else if (freeWindows.length < 6)
                      saveWindows([
                        ...freeWindows,
                        {
                          linkId: id,
                          x: 24 + freeWindows.length * 30,
                          y: 24 + freeWindows.length * 30,
                          width: 560,
                          height: 400,
                          maximized: false,
                          minimized: false,
                          zIndex: freeWindows.length,
                        },
                      ]);
                    event.target.value = '';
                  }}
                >
                  <option value="">Choose site</option>
                  {links.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {layout.mode !== 'free' ? (
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
            ) : null}
            {onSettings ? (
              <button className="rounded border border-border px-3 py-2" onClick={onSettings} type="button">
                {t('chat.webChat.editLinks')}
              </button>
            ) : null}
          </div>
        }
      />
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
        <div
          ref={container}
          className={`relative h-[65vh] min-h-80 w-full gap-1 ${layout.mode === 'free' ? 'overflow-hidden rounded border border-border bg-bg' : 'flex'}`}
          aria-label={t('webChat.panes')}
        >
          {layout.mode === 'free' ? (
            <>
              {freeWindows.map((item, index) => (
                <WebChatFloatingWindow
                  key={item.linkId}
                  window={item}
                  slot={index}
                  links={links}
                  contentRef={(element) => {
                    elements.current[index] = element;
                  }}
                  disabled={saving || suspended}
                  front={item.zIndex === Math.max(-1, ...freeWindows.map((windowItem) => windowItem.zIndex))}
                  minimized={item.minimized}
                  onRaise={() => {
                    const pending = host.raise?.(index);
                    if (pending) void pending.catch(nativeError);
                    saveWindows(
                      freeWindows.map((windowItem) => ({
                        ...windowItem,
                        zIndex:
                          windowItem.linkId === item.linkId
                            ? freeWindows.length
                            : windowItem.zIndex >= freeWindows.length
                              ? freeWindows.length - 1
                              : windowItem.zIndex,
                      })),
                    );
                  }}
                  onDragStart={() => {
                    const pending = host.setPaneVisible?.(index, false);
                    if (pending) void pending.catch(nativeError);
                  }}
                  onDragEnd={() => {
                    const pending = host.setPaneVisible?.(index, true);
                    if (pending) void pending.catch(nativeError);
                  }}
                  onChange={(updated) => {
                    saveWindows(
                      freeWindows.map((windowItem) => (windowItem.linkId === item.linkId ? updated : windowItem)),
                    );
                  }}
                  onClose={() => {
                    saveWindows(freeWindows.filter((windowItem) => windowItem.linkId !== item.linkId));
                  }}
                  onReload={() => {
                    void host.reload(index);
                  }}
                  onOpen={() => {
                    void openBrowser(index, item.linkId);
                  }}
                  onSelect={(linkId) => {
                    saveWindows(
                      freeWindows.map((windowItem) =>
                        windowItem.linkId === item.linkId ? { ...windowItem, linkId } : windowItem,
                      ),
                    );
                  }}
                  onMinimize={() => {
                    saveWindows(
                      freeWindows.map((windowItem) =>
                        windowItem.linkId === item.linkId ? { ...windowItem, minimized: true } : windowItem,
                      ),
                    );
                  }}
                  onMaximize={() => {
                    saveWindows(
                      freeWindows.map((windowItem) =>
                        windowItem.linkId === item.linkId
                          ? {
                              ...windowItem,
                              maximized: !windowItem.maximized,
                              x: 0,
                              y: 0,
                              width: container.current?.clientWidth ?? windowItem.width,
                              height: container.current?.clientHeight ?? windowItem.height,
                            }
                          : windowItem,
                      ),
                    );
                  }}
                />
              ))}
              <div
                className="absolute inset-x-0 bottom-0 z-[100] flex min-h-9 items-center gap-2 border-t border-border bg-surface/90 p-1"
                aria-label="Minimized web chats"
              >
                {freeWindows
                  .filter((item) => item.minimized)
                  .map((item) => (
                    <button
                      key={item.linkId}
                      className="rounded border border-border px-2 py-1 text-xs"
                      onClick={() => {
                        saveWindows(
                          freeWindows.map((windowItem) =>
                            windowItem.linkId === item.linkId
                              ? { ...windowItem, minimized: false, zIndex: freeWindows.length }
                              : windowItem,
                          ),
                        );
                      }}
                      type="button"
                    >
                      {links.find((link) => link.id === item.linkId)?.name}
                    </button>
                  ))}
              </div>
            </>
          ) : (
            layout.panes.map((linkId, slot) => (
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
                    onReload={() => {
                      void host.reload(slot).catch(() => {
                        reportFailed([linkId]);
                        nativeError();
                      });
                    }}
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
            ))
          )}
        </div>
      )}
    </section>
  );
}
