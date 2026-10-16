import { ThemeMode } from '@itstudio/schemas';
import type { ThemeId, ThemeTokens } from '@itstudio/schemas';
import { useState, useSyncExternalStore, type JSX, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useRpcQuery } from '../../../hooks/use-rpc-query';
import { useRpcClient } from '../../../rpc/rpc-context';
import { resolveTheme, themeCatalog } from '../../../theme/catalog';
import { applyTheme } from '../../../theme/apply-theme';
import { Select } from '../../../components/ui/primitives';
import { AppearanceControls } from './AppearanceControls';
import { APPEARANCE_EVENT, appearanceTokens, readAppearance, writeThemeCache } from '../../../theme/appearance';
import { ErrorPanel } from '../../../components/ErrorPanel';
import '../../../i18n';

const FILTERS = ['All', 'Focus', 'Calm', 'Warm', 'Creative', 'Dark-native'] as const;
const FILTER_IDS: Readonly<Record<(typeof FILTERS)[number], readonly string[]>> = {
  All: [],
  Focus: ['arctic-focus', 'midnight-focus', 'winter-stone', 'lemon-sky', 'neon-gold', 'neon-cyan'],
  Calm: ['deep-forest', 'blush-lavender', 'vintage-dawn', 'espresso', 'peach-cream'],
  Warm: ['sherbet', 'honey-sand', 'autumn-ember', 'candy-floss', 'berry-dusk', 'summer-meadow', 'neon-gold'],
  Creative: ['royal-ink', 'berry-dusk', 'sherbet', 'neon-violet'],
  'Dark-native': [],
};

function subscribeMode(listener: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', listener);
  return () => {
    media.removeEventListener('change', listener);
  };
}
function subscribeAppearance(listener: () => void): () => void {
  window.addEventListener(APPEARANCE_EVENT, listener);
  return () => {
    window.removeEventListener(APPEARANCE_EVENT, listener);
  };
}
function getAccent() {
  return readAppearance().accent;
}
function getMode(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function MiniPreview({ tokens, label }: { readonly tokens: ThemeTokens; readonly label: string }): JSX.Element {
  return (
    <div
      className="studio-mini"
      aria-hidden="true"
      style={{ background: tokens.bg, borderColor: tokens.border, color: tokens.text }}
    >
      <div className="studio-mini-nav" style={{ background: tokens.surface, borderColor: tokens.border }}>
        <span className="studio-mini-line" style={{ background: tokens.primary }} />
        <span className="studio-mini-line" style={{ background: tokens.textMuted }} />
        <span className="studio-mini-line" style={{ background: tokens.textMuted, width: '70%' }} />
      </div>
      <div className="studio-mini-content">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">IT Studio</span>
          <span style={{ color: tokens.textMuted }}>•••</span>
        </div>
        <div className="rounded border p-2" style={{ background: tokens.surface, borderColor: tokens.border }}>
          <span className="block studio-mini-line w-4/5" style={{ background: tokens.textMuted }} />
          <span className="mt-2 block studio-mini-line w-1/2" style={{ background: tokens.textMuted }} />
        </div>
        <span
          className="ml-auto rounded px-2 py-1 font-semibold"
          style={{ background: tokens.primary, color: tokens.primaryFg }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

export function ThemePage(): JSX.Element {
  const { t, i18n } = useTranslation();
  const rpc = useRpcClient();
  const queryClient = useQueryClient();
  const settings = useRpcQuery('settings.get', {});
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const ui = settings.data?.ui;
  const locale = ui?.locale ?? 'en';
  const mode = ui?.mode ?? ThemeMode.SYSTEM;
  const selectedId = ui?.themeId ?? themeCatalog.defaultLight;
  const prefersDark = useSyncExternalStore(subscribeMode, getMode);
  const accent = useSyncExternalStore(subscribeAppearance, getAccent);
  const activeThemeId = previewId ?? selectedId;
  const resolvedPreview = resolveTheme(activeThemeId, mode, prefersDark);
  const active = { ...resolvedPreview, tokens: appearanceTokens(resolvedPreview.tokens, accent) };
  const selectedTheme = resolveTheme(selectedId, mode, prefersDark);
  const themes = themeCatalog.themes.filter((item) =>
    filter === 'All'
      ? true
      : filter === 'Dark-native'
        ? item.nativeMode === 'dark'
        : FILTER_IDS[filter].includes(item.id),
  );

  async function save(patch: {
    readonly themeId?: ThemeId;
    readonly mode?: (typeof ThemeMode)[keyof typeof ThemeMode];
    readonly locale?: 'en' | 'vi';
  }): Promise<void> {
    setFailure(null);
    const nextThemeId = patch.themeId ?? selectedId;
    const nextMode = patch.mode ?? mode;
    const nextTheme = resolveTheme(nextThemeId, nextMode, prefersDark);
    applyTheme(nextTheme.definition.id, nextTheme.mode, nextTheme.tokens);
    try {
      const result = await rpc.call('settings.update', { patch: { ui: patch } });
      queryClient.setQueryData(['settings.get', {}], result);
      if (patch.locale !== undefined) await i18n.changeLanguage(patch.locale);
      try {
        writeThemeCache({ themeId: result.ui.themeId, mode: result.ui.mode });
      } catch {
        /* Startup cache is optional. */
      }
    } catch (error: unknown) {
      const previous = resolveTheme(selectedId, mode, prefersDark);
      applyTheme(previous.definition.id, previous.mode, previous.tokens);
      setFailure(error);
    }
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const activeId = document.activeElement?.getAttribute('data-theme-id');
      const activeTheme = themes.find((item) => item.id === activeId);
      if (activeTheme !== undefined) {
        void save({ themeId: activeTheme.id });
      }
      return;
    }
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const current = themes.findIndex((item) => item.id === document.activeElement?.getAttribute('data-theme-id'));
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = (current + delta + themes.length) % themes.length;
    document.querySelector<HTMLButtonElement>(`[data-theme-id="${themes[next]?.id ?? ''}"]`)?.focus();
  }

  return (
    <section className="space-y-6" aria-labelledby="theme-heading">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold" id="theme-heading">
            {t('theme.heading')}
          </h2>
          <p className="text-text-muted">{t('theme.description')}</p>
          <p className="text-sm text-text-muted">
            {t('theme.selected', { name: selectedTheme.definition.name, mode: t(`theme.${mode}`) })}
          </p>
        </div>
        <div className="flex gap-2" aria-label="Theme mode" role="group">
          {([ThemeMode.SYSTEM, ThemeMode.LIGHT, ThemeMode.DARK] as const).map((option) => (
            <button
              aria-pressed={mode === option}
              className="rounded border border-border px-3 py-2 aria-pressed:bg-primary aria-pressed:text-primary-fg"
              key={option}
              onClick={() => void save({ mode: option })}
              type="button"
            >
              {t(`theme.${option}`)}
            </button>
          ))}
          <button
            className="rounded border border-border px-3 py-2 hover:bg-surface-alt"
            onClick={() =>
              void save({
                themeId: prefersDark ? themeCatalog.defaultDark : themeCatalog.defaultLight,
                mode: ThemeMode.SYSTEM,
              })
            }
            type="button"
          >
            {t('theme.reset')}
          </button>
        </div>
      </div>
      <section aria-label={t('theme.appearance')} className="studio-card flex flex-wrap items-center gap-3 p-4">
        <h3 className="font-semibold">{t('theme.appearance')}</h3>
        <label className="flex items-center gap-2">
          {t('theme.language')}
          <Select
            aria-label={t('theme.language')}
            className="rounded border border-border bg-bg px-3 py-2 text-text"
            onChange={(event) => {
              void save({ locale: event.target.value as 'en' | 'vi' });
            }}
            value={locale}
          >
            <option value="en">{t('theme.english')}</option>
            <option value="vi">{t('theme.vietnamese')}</option>
          </Select>
        </label>
      </section>
      <AppearanceControls />
      <div className="flex flex-wrap gap-2" aria-label={t('theme.filtersLabel')}>
        {FILTERS.map((item) => (
          <button
            aria-pressed={filter === item}
            className="rounded-full border border-border px-3 py-1 aria-pressed:bg-primary aria-pressed:text-primary-fg"
            key={item}
            onClick={() => {
              setFilter(item);
            }}
            type="button"
          >
            {t(`theme.filter${item === 'Dark-native' ? 'Dark' : item}`)}
          </button>
        ))}
      </div>
      {failure !== null ? (
        <ErrorPanel
          error={{
            code: 'INTERNAL',
            message: t('theme.saveError'),
            remediation: ['Check the sidecar connection and try again.'],
            retryable: true,
          }}
          onRetry={() => {
            void save({ themeId: selectedId });
          }}
        />
      ) : null}
      <div
        className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4"
        aria-label={t('theme.themes')}
        role="radiogroup"
        onKeyDown={onGridKeyDown}
      >
        {themes.map((item) => {
          const variant = resolveTheme(item.id, mode, prefersDark);
          return (
            <div
              key={item.id}
              onMouseEnter={() => {
                setPreviewId(item.id);
              }}
              onMouseLeave={() => {
                setPreviewId(null);
              }}
            >
              <button
                aria-checked={selectedId === item.id}
                className="studio-theme-card studio-card w-full space-y-3 p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                data-theme-id={item.id}
                onClick={() => {
                  void save({ themeId: item.id });
                }}
                role="radio"
                type="button"
              >
                <span aria-hidden="true" className="flex h-3 overflow-hidden rounded">
                  {item.palette.map((color, index) => (
                    <span
                      className="flex-1"
                      key={`${item.id}-${index.toString()}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </span>
                <MiniPreview label={t('theme.cardPreview')} tokens={appearanceTokens(variant.tokens, accent)} />
                <span className="block font-medium">
                  {item.name}
                  {selectedId === item.id ? ' ✓' : ''}
                </span>
                <span className="block text-sm text-text-muted">{item.mood}</span>
              </button>
              <button
                aria-expanded={detailsId === item.id}
                aria-label={`About ${item.name}`}
                className="mt-2 rounded px-2 py-1 text-sm text-text-muted hover:bg-surface-alt"
                onClick={() => {
                  setDetailsId(detailsId === item.id ? null : item.id);
                }}
                type="button"
              >
                ⓘ {t('theme.details')}
              </button>
              {detailsId === item.id ? (
                <div className="studio-card p-3 text-sm">
                  <p>{item.psychology}</p>
                  <p className="mt-2 text-text-muted">
                    {t('theme.recommended', { activities: item.recommendedFor.join(', ') })}
                  </p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <aside aria-label={t('theme.previewLabel')} className="studio-card grid gap-4 p-4 md:grid-cols-3">
        <div>
          <h3 className="font-semibold">{t('theme.preview', { name: active.definition.name })}</h3>
          <p className="text-text-muted">{t('theme.hover')}</p>
          <MiniPreview label={t('theme.cardPreview')} tokens={active.tokens} />
        </div>
        <div
          className="rounded border border-border p-3"
          style={{ backgroundColor: active.tokens.bg, color: active.tokens.text }}
        >
          <p>{t('theme.chatPreview')}</p>
          <button
            className="mt-2 rounded px-3 py-2"
            style={{ backgroundColor: active.tokens.primary, color: active.tokens.primaryFg }}
            type="button"
          >
            {t('theme.send')}
          </button>
        </div>
        <div
          className="rounded border border-border p-3"
          style={{ backgroundColor: active.tokens.surface, color: active.tokens.text }}
        >
          <p>
            {t('theme.profit')} <span style={{ color: active.tokens.success }}>+$12.40</span>
          </p>
          <p style={{ color: active.tokens.textMuted }}>{t('theme.vnd')}</p>
          <div className="mt-2 flex gap-2">
            <span style={{ color: active.tokens.warning }}>{t('theme.warning')}</span>
            <span style={{ color: active.tokens.danger }}>{t('theme.danger')}</span>
          </div>
        </div>
      </aside>
    </section>
  );
}
