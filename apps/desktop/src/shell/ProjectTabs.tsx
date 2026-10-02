import type { Project } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

export function ProjectTabs({
  projects,
  openIds,
  activeId,
  onActivate,
  onClose,
  onAdd,
  error,
}: {
  readonly projects: readonly Project[];
  readonly openIds: readonly string[];
  readonly activeId: string | null;
  readonly onActivate: (id: string | null) => void;
  readonly onClose: (id: string) => void;
  readonly onAdd: () => void;
  readonly error: string | null;
}): JSX.Element {
  const { t } = useTranslation();
  const openProjects = projects.filter((project) => openIds.includes(project.id));
  return (
    <div
      aria-label={t('projects.all')}
      className="flex min-h-12 items-center gap-1 overflow-x-auto border-b border-border bg-surface px-3"
      role="tablist"
    >
      <button
        aria-selected={activeId === null}
        className="rounded-t px-3 py-2 aria-selected:border-b-2 aria-selected:border-primary"
        onClick={() => {
          onActivate(null);
        }}
        role="tab"
        type="button"
      >
        {t('projects.all')}
      </button>
      {openProjects.map((project) => (
        <div
          className="flex items-center rounded-t aria-selected:border-b-2 aria-selected:border-primary"
          key={project.id}
        >
          <button
            aria-selected={activeId === project.id}
            className="px-3 py-2"
            onClick={() => {
              onActivate(project.id);
            }}
            role="tab"
            type="button"
          >
            {project.name}
          </button>
          <button
            aria-label={t('projects.close', { name: project.name })}
            className="px-2 text-text-muted hover:text-text"
            onClick={() => {
              onClose(project.id);
            }}
            type="button"
          >
            ×
          </button>
        </div>
      ))}
      <button
        aria-label={t('projects.add')}
        className="rounded px-3 py-2 hover:bg-surface-alt"
        onClick={onAdd}
        type="button"
      >
        +
      </button>
      {error !== null ? (
        <span className="sr-only" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
