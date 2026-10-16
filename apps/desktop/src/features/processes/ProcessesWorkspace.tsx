import type { ActivityEvent, ProcessKind, ProcessRecord, Project, ProjectId } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ProcessesPage } from './ProcessesPage';
import { WorkflowPage } from '../workflow/WorkflowPage';

export type ProcessesTab = 'processes' | 'system-map';

export function readProcessesTab(): ProcessesTab {
  try {
    return localStorage.getItem('itstudio.processesTab') === 'system-map' ? 'system-map' : 'processes';
  } catch {
    return 'processes';
  }
}

export function writeProcessesTab(tab: ProcessesTab): void {
  try {
    localStorage.setItem('itstudio.processesTab', tab);
  } catch {
    // Storage can be unavailable in private or restricted contexts.
  }
}

export function ProcessesWorkspace({
  tab,
  onTabChange,
  projectId,
  projects,
  initialKind,
  onOpen,
  onNavigate,
  onShowProcesses,
}: {
  readonly tab: ProcessesTab;
  readonly onTabChange: (tab: ProcessesTab) => void;
  readonly projectId: ProjectId | null;
  readonly projects: readonly Project[];
  readonly initialKind: ProcessKind | '';
  readonly onOpen: (record: ProcessRecord) => void;
  readonly onNavigate: (route: 'chat' | 'code' | 'knowledge' | 'cost', event?: ActivityEvent) => void;
  readonly onShowProcesses: (kind: ProcessKind) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="space-y-5">
      <div aria-label={t('processes.tabs.label')} className="flex gap-2" role="tablist">
        {(['processes', 'system-map'] as const).map((target) => (
          <button
            aria-selected={tab === target}
            className="rounded border border-border px-3 py-2 aria-selected:bg-surface-alt"
            key={target}
            onClick={() => {
              onTabChange(target);
            }}
            role="tab"
          >
            {t(`processes.tabs.${target}`)}
          </button>
        ))}
      </div>
      {tab === 'processes' ? (
        <ProcessesPage projectId={projectId} projects={projects} initialKind={initialKind} onOpen={onOpen} />
      ) : (
        <WorkflowPage
          projectId={projectId}
          projects={projects.map(({ id, name }) => ({ id, name }))}
          onNavigate={onNavigate}
          onShowProcesses={onShowProcesses}
        />
      )}
    </section>
  );
}
