import { useEffect, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import './i18n';
import { useRpcQuery } from './hooks/use-rpc-query';
import { AppShell } from './shell/AppShell';
import { ThemeSync } from './theme/ThemeSync';

export function App(): JSX.Element {
  const settings = useRpcQuery('settings.get', {});
  const { i18n } = useTranslation();
  useEffect(() => {
    const locale = settings.data?.ui.locale;
    if (locale !== undefined && i18n.resolvedLanguage !== locale) void i18n.changeLanguage(locale);
  }, [i18n, settings.data?.ui.locale]);
  return (
    <>
      <ThemeSync />
      <AppShell />
    </>
  );
}
