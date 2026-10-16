import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../components/ui/Icon';
import { readThemeCache, writeThemeCache } from '../theme/appearance';
import type { SettingsSectionRoute } from '../features/settings/settings-sections';
import { ProcessCounts } from '../features/processes/ProcessCounts';

export type ShellRoute =
  | 'projects'
  | 'pipeline-studio'
  | 'chat'
  | 'webchat'
  | 'code'
  | 'knowledge'
  | 'workflow'
  | 'processes'
  | 'gallery'
  | 'cost'
  | 'settings'
  | SettingsSectionRoute;

export function MainNav({
  route,
  navigate,
  projectName,
}: {
  readonly route: ShellRoute;
  readonly navigate: (route: ShellRoute) => void;
  readonly projectName?: string | undefined;
}): JSX.Element {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => readThemeCache().sidebarCollapsed === true);
  const links: readonly { readonly route: ShellRoute; readonly label: string; readonly icon: IconName }[] = [
    { route: 'projects', label: t('nav.projects'), icon: 'projects' },
    { route: 'chat', label: t('nav.chat'), icon: 'chat' },
    { route: 'webchat', label: t('nav.webChat'), icon: 'web' },
    { route: 'code', label: t('nav.code'), icon: 'code' },
    { route: 'knowledge', label: t('nav.knowledge'), icon: 'knowledge' },
    { route: 'gallery', label: t('nav.gallery'), icon: 'gallery' },
    { route: 'cost', label: t('nav.cost'), icon: 'cost' },
    { route: 'processes', label: t('processes.heading'), icon: 'processes' },
  ];
  const linkClass =
    'studio-nav-link flex items-center gap-3 rounded px-3 py-2 hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-focus-ring';
  return (
    <nav
      aria-label={t('nav.main')}
      data-collapsed={collapsed}
      className="studio-sidebar flex shrink-0 flex-col overflow-y-auto border-r border-border bg-surface p-3"
    >
      <div className="studio-brand flex items-center gap-3" title={t('app.name')}>
        <span className="studio-brand-mark">
          <Icon name="studio" />
        </span>
        <h1 className={collapsed ? 'sr-only' : 'text-lg font-semibold'}>{t('app.name')}</h1>
      </div>
      <div className="studio-project-context" title={projectName ?? t('projects.all')}>
        <Icon name="projects" />
        <div className={collapsed ? 'sr-only' : 'min-w-0'}>
          <p className="text-xs text-text-muted">{t('character.workspace')}</p>
          <p className="truncate font-semibold">{projectName ?? t('projects.all')}</p>
        </div>
      </div>
      <div className="space-y-1">
        {links.map(({ route: target, label, icon }) => (
          <a
            aria-label={label}
            title={collapsed ? label : undefined}
            aria-current={route === target ? 'page' : undefined}
            className={linkClass}
            href={`#${target}`}
            key={target}
            onClick={(event) => {
              event.preventDefault();
              navigate(target);
            }}
          >
            <Icon name={icon} />
            <span className={collapsed ? 'sr-only' : ''}>{label}</span>
            {collapsed ? (
              <span className="studio-nav-tooltip" aria-hidden="true">
                {label}
              </span>
            ) : null}
            {target === 'processes' && !collapsed ? (
              <span className="ml-2">
                <ProcessCounts />
              </span>
            ) : null}
          </a>
        ))}
      </div>
      <div className="mt-auto space-y-2 border-t border-border pt-4">
        <a
          aria-label={t('nav.settings')}
          title={collapsed ? t('nav.settings') : undefined}
          aria-current={route.startsWith('settings') ? 'page' : undefined}
          className={linkClass}
          href="#settings"
          onClick={(event) => {
            event.preventDefault();
            navigate('settings');
          }}
        >
          <Icon name="settings" />
          <span className={collapsed ? 'sr-only' : ''}>{t('nav.settings')}</span>
          {collapsed ? (
            <span className="studio-nav-tooltip" aria-hidden="true">
              {t('nav.settings')}
            </span>
          ) : null}
        </a>
        <button
          className={`${linkClass} w-full text-sm text-text-muted`}
          type="button"
          aria-label={t('character.toggleSidebar')}
          aria-expanded={!collapsed}
          title={t(collapsed ? 'character.expand' : 'character.collapse')}
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            writeThemeCache({ sidebarCollapsed: next });
          }}
        >
          <Icon name={collapsed ? 'expand' : 'collapse'} />
          <span className={collapsed ? 'sr-only' : ''}>{t('character.collapse')}</span>
        </button>
      </div>
    </nav>
  );
}
