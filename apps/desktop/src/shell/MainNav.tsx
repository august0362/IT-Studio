import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

export type ShellRoute =
  | 'chat'
  | 'code'
  | 'knowledge'
  | 'workflow'
  | 'cost'
  | 'settings-api-keys'
  | 'settings-theme'
  | 'settings-router'
  | 'settings-budget'
  | 'settings-pricing'
  | 'settings-fx'
  | 'settings-vscode'
  | 'settings-pipeline';

export function MainNav({
  route,
  navigate,
}: {
  readonly route: ShellRoute;
  readonly navigate: (route: ShellRoute) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const links: readonly { readonly route: ShellRoute; readonly label: string }[] = [
    { route: 'chat', label: t('nav.chat') },
    { route: 'code', label: t('nav.code') },
    { route: 'knowledge', label: t('nav.knowledge') },
    { route: 'cost', label: t('nav.cost') },
    { route: 'workflow', label: t('nav.workflow') },
  ];
  return (
    <nav aria-label="Main navigation" className="w-56 shrink-0 border-r border-border bg-surface p-4">
      <h1 className="mb-6 text-lg font-semibold">{t('app.name')}</h1>
      <div className="space-y-1">
        {links.slice(0, 3).map(({ route: target, label }) => (
          <a
            aria-current={route === target ? 'page' : undefined}
            className="block rounded px-3 py-2 hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-focus-ring"
            href={`#${target}`}
            key={target}
            onClick={(event) => {
              event.preventDefault();
              navigate(target);
            }}
          >
            {label}
          </a>
        ))}
        <span aria-disabled="true" className="block rounded px-3 py-2 text-text-muted" title={t('nav.comingSoon')}>
          {t('nav.gallery')} <span className="text-xs">({t('nav.comingSoon')})</span>
        </span>
        <a
          aria-current={route === 'cost' ? 'page' : undefined}
          className="block rounded px-3 py-2 hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-focus-ring"
          href="#cost"
          onClick={(event) => {
            event.preventDefault();
            navigate('cost');
          }}
        >
          {links[3]?.label}
        </a>
      </div>
      <div className="mt-6 border-t border-border pt-4">
        <div className="mb-1 px-3 text-xs font-semibold uppercase text-text-muted">{t('nav.settings')}</div>
        <a
          aria-current={route === 'settings-api-keys' ? 'page' : undefined}
          className="block rounded px-3 py-2 hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-focus-ring"
          href="#settings-api-keys"
          onClick={(event) => {
            event.preventDefault();
            navigate('settings-api-keys');
          }}
        >
          {t('nav.apiKeys')}
        </a>
        <a
          aria-current={route === 'settings-theme' ? 'page' : undefined}
          className="block rounded px-3 py-2 hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-focus-ring"
          href="#settings-theme"
          onClick={(event) => {
            event.preventDefault();
            navigate('settings-theme');
          }}
        >
          {t('nav.theme')}
        </a>
        {(
          [
            'settings-router',
            'settings-budget',
            'settings-pricing',
            'settings-fx',
            'settings-vscode',
            'settings-pipeline',
          ] as const
        ).map((target) => (
          <a
            aria-current={route === target ? 'page' : undefined}
            className="block rounded px-3 py-2 hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-focus-ring"
            href={`#${target}`}
            key={target}
            onClick={(event) => {
              event.preventDefault();
              navigate(target);
            }}
          >
            {t(`settings.nav.${target.replace('settings-', '')}`)}
          </a>
        ))}
        <a
          aria-current={route === 'workflow' ? 'page' : undefined}
          className="block rounded px-3 py-2 hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-focus-ring"
          href="#workflow"
          onClick={(event) => {
            event.preventDefault();
            navigate('workflow');
          }}
        >
          {links[4]?.label}
        </a>
      </div>
    </nav>
  );
}
