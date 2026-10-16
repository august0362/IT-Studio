import { Select } from '../../components/ui/primitives';
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ResolvedWebChatSettingsPage } from '../webchat/ResolvedWebChatSettingsPage';
import { SettingsTargetContext } from './settings-target';
import { SettingsSearch } from './SettingsSearch';
import { ApiKeysPage } from './api-keys/ApiKeysPage';
import { BudgetSettingsPage } from './budget/BudgetSettingsPage';
import { FxSettingsPage } from './fx/FxSettingsPage';
import { ImagesSettingsPage } from './images/ImagesSettingsPage';
import { PipelineSettingsPage } from './pipeline/PipelineSettingsPage';
import { PricingSettingsPage } from './pricing/PricingSettingsPage';
import { RouterSettingsPage } from './router/RouterSettingsPage';
import { ThemePage } from './theme/ThemePage';
import { VSCodeSettingsPage } from './vscode/VSCodeSettingsPage';
import {
  isSettingsSectionRoute,
  rememberSettingsRoute,
  SETTINGS_SECTIONS,
  normalizeSettingsText,
  type SettingSuggestion,
  type SettingsSectionRoute,
} from './settings-sections';

export function SettingsPage({
  section,
  navigate,
  projectActive,
  labs,
}: {
  readonly section: SettingsSectionRoute;
  readonly navigate: (route: SettingsSectionRoute) => void;
  readonly projectActive: boolean;
  readonly labs: ReactNode;
}): JSX.Element {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<SettingSuggestion | null>(null);
  const contentRoot = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const title = (route: SettingsSectionRoute): string => t(`settings.sections.${route.slice('settings-'.length)}`);
  const query = normalizeSettingsText(search.trim());
  const sections = SETTINGS_SECTIONS.filter(({ route, keywords }) =>
    normalizeSettingsText(`${title(route)} ${keywords}`).includes(query),
  );

  useEffect(() => {
    rememberSettingsRoute(section);
    heading.current?.focus();
  }, [section]);

  useEffect(() => {
    if (target?.section !== section) return;
    const root = contentRoot.current;
    if (root === null) return;
    const focus = (): boolean => {
      const field = document.getElementById(target.id ?? 'settings-page-heading');
      if (!(field instanceof HTMLElement) || field.matches(':disabled')) return false;
      field.scrollIntoView({ block: 'center', behavior: 'smooth' });
      field.focus();
      return document.activeElement === field;
    };
    if (focus()) return;
    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true });
    return () => {
      observer.disconnect();
    };
  }, [target, section]);

  let content: ReactNode;
  switch (section) {
    case 'settings-api-keys':
      content = <ApiKeysPage />;
      break;
    case 'settings-router':
      content = <RouterSettingsPage />;
      break;
    case 'settings-pipeline':
      content = <PipelineSettingsPage />;
      break;
    case 'settings-budget':
      content = <BudgetSettingsPage />;
      break;
    case 'settings-pricing':
      content = <PricingSettingsPage projectActive={projectActive} />;
      break;
    case 'settings-fx':
      content = <FxSettingsPage />;
      break;
    case 'settings-images':
      content = <ImagesSettingsPage />;
      break;
    case 'settings-web-chat':
      content = <ResolvedWebChatSettingsPage />;
      break;
    case 'settings-vscode':
      content = <VSCodeSettingsPage />;
      break;
    case 'settings-theme':
      content = <ThemePage />;
      break;
    case 'settings-labs':
      content = labs;
      break;
  }

  return (
    <section
      aria-labelledby="settings-page-heading"
      className="studio-settings flex min-w-0 flex-col gap-6 lg:flex-row"
    >
      <div className="shrink-0 space-y-3 lg:w-52">
        <SettingsSearch
          value={search}
          onChange={setSearch}
          onChoose={(entry) => {
            setTarget({ ...entry });
            setSearch('');
            navigate(entry.section);
          }}
        />
        <div className="lg:hidden">
          <label className="mb-1 block text-sm" htmlFor="settings-section">
            {t('settings.section')}
          </label>
          <Select
            className="w-full rounded border border-border bg-surface px-3 py-2 text-text"
            id="settings-section"
            disabled={sections.length === 0}
            value={sections.some(({ route }) => route === section) ? section : ''}
            onChange={(event) => {
              if (isSettingsSectionRoute(event.target.value)) navigate(event.target.value);
            }}
          >
            <option value="" disabled>
              {t('settings.chooseSection')}
            </option>
            {sections.map(({ route }) => (
              <option key={route} value={route}>
                {title(route)}
              </option>
            ))}
          </Select>
        </div>
        <nav aria-label={t('settings.section')} className="hidden lg:block">
          <ul className="space-y-1">
            {sections.map(({ route }) => (
              <li key={route}>
                <a
                  aria-current={route === section ? 'page' : undefined}
                  className="block rounded px-3 py-2 hover:bg-surface-alt aria-[current=page]:bg-surface-alt focus-visible:outline-2 focus-visible:outline-focus-ring"
                  href={`#${route}`}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(route);
                  }}
                >
                  {title(route)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {sections.length === 0 ? (
          <p className="text-sm text-text-muted" role="status">
            {t('settings.noMatches')}
          </p>
        ) : null}
      </div>
      <div ref={contentRoot} className="min-w-0 flex-1 space-y-5">
        <h2
          className="text-2xl font-semibold focus-visible:outline-2 focus-visible:outline-focus-ring"
          id="settings-page-heading"
          ref={heading}
          tabIndex={-1}
        >
          {t('settings.sectionHeading', { section: title(section) })}
        </h2>
        <SettingsTargetContext value={target?.section === section ? target.id : undefined}>
          {content}
        </SettingsTargetContext>
      </div>
    </section>
  );
}
