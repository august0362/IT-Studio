import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
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
}: {
  readonly route: ShellRoute;
  readonly navigate: (route: ShellRoute) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const links: readonly { readonly route: ShellRoute; readonly label: string }[] = [
    { route: 'projects', label: t('nav.projects') },
    { route: 'chat', label: t('nav.chat') },
    { route: 'webchat', label: t('nav.webChat') },
    { route: 'code', label: t('nav.code') },
    { route: 'knowledge', label: t('nav.knowledge') },
    { route: 'gallery', label: t('nav.gallery') },
    { route: 'cost', label: t('nav.cost') },
    { route: 'processes', label: t('processes.heading') },
  ];
  const linkClass =
    'block rounded px-3 py-2 hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-focus-ring';
  return (
    <nav
      aria-label={t('nav.main')}
      className="studio-sidebar flex w-56 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface p-4"
    >
      <h1 className="mb-6 text-lg font-semibold">{t('app.name')}</h1>
      <div className="space-y-1">
        {links.map(({ route: target, label }) => (
          <a
            aria-label={target === 'processes' ? label : undefined}
            aria-current={route === target ? 'page' : undefined}
            className={linkClass}
            href={`#${target}`}
            key={target}
            onClick={(event) => {
              event.preventDefault();
              navigate(target);
            }}
          >
            {label}
            {target === 'processes' ? (
              <span className="ml-2">
                <ProcessCounts />
              </span>
            ) : null}
          </a>
        ))}
      </div>
      <div className="mt-auto border-t border-border pt-4">
        <a
          aria-current={route.startsWith('settings') ? 'page' : undefined}
          className={linkClass}
          href="#settings"
          onClick={(event) => {
            event.preventDefault();
            navigate('settings');
          }}
        >
          <span aria-hidden="true" className="mr-2">
            ⚙
          </span>
          {t('nav.settings')}
        </a>
      </div>
    </nav>
  );
}
