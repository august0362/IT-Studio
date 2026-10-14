import { WebChatBrowser } from '@itstudio/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { useRpcMutation } from '../../hooks/use-rpc-mutation';
import { useRpcQuery } from '../../hooks/use-rpc-query';
import { WebChatSettingsPage } from '../settings/web-chat/WebChatSettingsPage';

const RESOLVED_BROWSER_KEY = 'itstudio.webchat.coccoc-default-resolved';

function defaultResolutionComplete(): boolean {
  try {
    return window.localStorage.getItem(RESOLVED_BROWSER_KEY) === '1';
  } catch {
    return false;
  }
}

function markDefaultResolved(): void {
  try {
    window.localStorage.setItem(RESOLVED_BROWSER_KEY, '1');
  } catch {
    // The settings value itself is still persisted by settings.update.
  }
}

export function ResolvedWebChatSettingsPage(): JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settings = useRpcQuery('settings.get', {});
  const browsers = useRpcQuery('webchat.browsers', {});
  const update = useRpcMutation('settings.update');
  const { mutate: updateSettings, isError, isIdle } = update;
  const hasResolvedDefault = defaultResolutionComplete();
  const coccocInstalled = browsers.data?.some((option) => option.browser === WebChatBrowser.COCCOC && option.installed);
  const shouldResolve =
    settings.data?.webChat.browser === WebChatBrowser.DEFAULT && coccocInstalled === true && !hasResolvedDefault;

  const persistCoccoc = useCallback((): void => {
    updateSettings(
      { patch: { webChat: { browser: WebChatBrowser.COCCOC } } },
      {
        onSuccess: (saved) => {
          queryClient.setQueryData(['settings.get', {}], saved);
          markDefaultResolved();
        },
      },
    );
  }, [queryClient, updateSettings]);

  useEffect(() => {
    if (settings.data === undefined || browsers.data === undefined || hasResolvedDefault) return;
    if (settings.data.webChat.browser !== WebChatBrowser.DEFAULT) {
      markDefaultResolved();
      return;
    }
    if (coccocInstalled === true && isIdle) persistCoccoc();
  }, [browsers.data, coccocInstalled, hasResolvedDefault, isIdle, persistCoccoc, settings.data]);

  if (settings.isPending || browsers.isPending || (shouldResolve && !isError)) {
    return <p role="status">{t('settings.loading')}</p>;
  }

  return (
    <>
      {shouldResolve && isError ? (
        <div className="mb-4 flex items-center gap-3" role="alert">
          <p>{t('settings.webChat.resolveError')}</p>
          <button className="rounded border border-border px-3 py-1" onClick={persistCoccoc} type="button">
            {t('settings.webChat.retryResolution')}
          </button>
        </div>
      ) : null}
      <WebChatSettingsPage />
    </>
  );
}
