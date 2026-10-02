import { ThemeMode } from '@itstudio/schemas';
import type { ThemeId } from '@itstudio/schemas';
import { useEffect, type JSX } from 'react';
import { useRpcQuery } from '../hooks/use-rpc-query';
import { applyTheme, enableThemeTransitions } from './apply-theme';
import { resolveTheme, themeCatalog } from './catalog';

const STORAGE_KEY = 'itstudio.theme';

export function ThemeSync(): JSX.Element | null {
  const settings = useRpcQuery('settings.get', {});

  useEffect(() => {
    enableThemeTransitions();
    const preference = window.matchMedia('(prefers-color-scheme: dark)');
    let themeId: ThemeId = themeCatalog.defaultLight;
    let mode: 'system' | 'light' | 'dark' = ThemeMode.SYSTEM;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const cached: unknown = JSON.parse(raw);
        if (typeof cached === 'object' && cached !== null && 'themeId' in cached && 'mode' in cached) {
          if (typeof cached.themeId === 'string') {
            const cachedTheme = themeCatalog.themes.find((item) => item.id === cached.themeId);
            if (cachedTheme !== undefined) themeId = cachedTheme.id;
          }
          if (cached.mode === 'system' || cached.mode === 'light' || cached.mode === 'dark') mode = cached.mode;
        }
      }
    } catch {
      // Storage can be disabled; the bundled defaults still apply.
    }
    const apply = () => {
      const resolved = resolveTheme(themeId, mode, preference.matches);
      applyTheme(resolved.definition.id, resolved.mode, resolved.tokens);
    };
    const updateCache = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ themeId, mode }));
      } catch {
        // Storage is an optimization for startup only.
      }
    };
    const onPreferenceChange = () => {
      apply();
    };
    preference.addEventListener('change', onPreferenceChange);
    apply();
    if (settings.data !== undefined) {
      themeId = settings.data.ui.themeId;
      mode = settings.data.ui.mode;
      apply();
      updateCache();
    }
    return () => {
      preference.removeEventListener('change', onPreferenceChange);
    };
  }, [settings.data]);

  return null;
}
