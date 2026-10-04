import type { AppError, ProjectId } from '@itstudio/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiKeysPage } from '../features/settings/api-keys/ApiKeysPage';
import { ThemePage } from '../features/settings/theme/ThemePage';
import { StatusBar } from '../components/StatusBar';
import { useRpcQuery } from '../hooks/use-rpc-query';
import { RpcCallError } from '../rpc/rpc-client';
import { useRpcClient } from '../rpc/rpc-context';
import { readOpenProjects, writeOpenProjects } from '../state/open-projects';
import { MainNav, type ShellRoute } from './MainNav';
import { NewProjectDialog } from './NewProjectDialog';
import { ProjectTabs } from './ProjectTabs';
import { ChatPage } from '../features/chat/ChatPage';
import { RouterSettingsPage } from '../features/settings/router/RouterSettingsPage';
import { BudgetSettingsPage } from '../features/settings/budget/BudgetSettingsPage';
import { PricingSettingsPage } from '../features/settings/pricing/PricingSettingsPage';
import { FxSettingsPage } from '../features/settings/fx/FxSettingsPage';
import { VSCodeSettingsPage } from '../features/settings/vscode/VSCodeSettingsPage';
import { PipelineSettingsPage } from '../features/settings/pipeline/PipelineSettingsPage';
import { KnowledgePage } from '../features/knowledge/KnowledgePage';
import { ImagesSettingsPage } from '../features/settings/images/ImagesSettingsPage';
import { useNavigationIntent } from '../state/navigation-intent';

const CodePage = lazy(() => import('../features/code/CodePage').then(({ CodePage: page }) => ({ default: page })));
const CostPage = lazy(() => import('../features/cost/CostPage').then(({ CostPage: page }) => ({ default: page })));
const WorkflowPage = lazy(() =>
  import('../features/workflow/WorkflowPage').then(({ WorkflowPage: page }) => ({ default: page })),
);
const GalleryPage = lazy(() =>
  import('../features/gallery/GalleryPage').then(({ GalleryPage: page }) => ({ default: page })),
);

function asAppError(cause: unknown): AppError {
  if (cause instanceof RpcCallError) return cause.appError;
  return { code: 'INTERNAL', message: 'The request could not be completed.', retryable: true };
}

function initialRoute(): ShellRoute {
  const hash = window.location.hash.slice(1);
  if (
    [
      'chat',
      'code',
      'knowledge',
      'workflow',
      'gallery',
      'cost',
      'settings-api-keys',
      'settings-theme',
      'settings-router',
      'settings-budget',
      'settings-pricing',
      'settings-fx',
      'settings-vscode',
      'settings-pipeline',
      'settings-images',
    ].includes(hash)
  )
    return hash as ShellRoute;
  return 'settings-api-keys';
}

export function AppShell(): JSX.Element {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const queryClient = useQueryClient();
  const projectsQuery = useRpcQuery('project.list', {});
  const settingsQuery = useRpcQuery('settings.get', {});
  const [route, setRoute] = useState<ShellRoute>(initialRoute);
  const [openIds, setOpenIds] = useState<string[]>(readOpenProjects);
  const [activeSelection, setActiveSelection] = useState<
    { readonly kind: 'project'; readonly id: string } | { readonly kind: 'all' } | undefined
  >(undefined);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectError, setProjectError] = useState<AppError | null>(null);
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const validOpenIds = useMemo(
    () => openIds.filter((id) => projects.some((project) => project.id === id)),
    [openIds, projects],
  );
  const configuredActiveId = settingsQuery.data?.activeProjectId;
  const activeId =
    activeSelection?.kind === 'all'
      ? null
      : activeSelection?.kind === 'project'
        ? activeSelection.id
        : configuredActiveId !== null &&
            configuredActiveId !== undefined &&
            projects.some((project) => project.id === configuredActiveId)
          ? configuredActiveId
          : (validOpenIds[0] ?? null);
  const visibleOpenIds = useMemo(
    () => (activeId !== null && !validOpenIds.includes(activeId) ? [...validOpenIds, activeId] : validOpenIds),
    [activeId, validOpenIds],
  );

  useEffect(() => {
    writeOpenProjects(visibleOpenIds);
  }, [visibleOpenIds]);
  useEffect(() => {
    const listener = () => {
      setRoute(initialRoute());
    };
    window.addEventListener('hashchange', listener);
    return () => {
      window.removeEventListener('hashchange', listener);
    };
  }, []);

  function navigate(next: ShellRoute): void {
    setRoute(next);
    window.history.replaceState(null, '', `#${next}`);
  }

  async function activate(id: string | null): Promise<void> {
    if (id !== null) {
      const project = projects.find((item) => item.id === id);
      if (project === undefined) return;
      try {
        await rpc.call('project.setActive', { projectId: project.id });
        await queryClient.invalidateQueries({ queryKey: ['settings.get', {}] });
      } catch (cause: unknown) {
        setProjectError(asAppError(cause));
        return;
      }
    }
    setActiveSelection(id === null ? { kind: 'all' } : { kind: 'project', id });
    if (id !== null) setOpenIds((current) => (current.includes(id) ? current : [...current, id]));
  }

  async function createProject(name: string, workspaceRoot: string): Promise<void> {
    setProjectError(null);
    try {
      const project = await rpc.call('project.create', { name, workspaceRoot });
      const nextProjects = [...projects, project];
      queryClient.setQueryData(['project.list', {}], nextProjects);
      setOpenIds((current) => (current.includes(project.id) ? current : [...current, project.id]));
      await rpc.call('project.setActive', { projectId: project.id });
      await queryClient.invalidateQueries({ queryKey: ['settings.get', {}] });
      setActiveSelection({ kind: 'project', id: project.id });
      setShowNewProject(false);
    } catch (cause: unknown) {
      setProjectError(asAppError(cause));
    }
  }

  function closeProject(id: string): void {
    const remaining = openIds.filter((openId) => openId !== id);
    setOpenIds(remaining);
    if (activeId === id) setActiveSelection({ kind: 'all' });
  }

  let content: JSX.Element;
  if (route === 'chat')
    content = <ChatPage projectId={projects.find((project) => project.id === activeId)?.id ?? null} />;
  else if (route === 'knowledge')
    content = (
      <KnowledgePage
        project={projects.find((project) => project.id === activeId)}
        projectId={projects.find((project) => project.id === activeId)?.id ?? null}
      />
    );
  else if (route === 'workflow')
    content = (
      <Suspense fallback={<p role="status">{t('workflow.loading')}</p>}>
        <WorkflowPage
          onNavigate={(target, event) => {
            const refs = event?.refs;
            if (target === 'chat' && refs?.conversationId !== undefined)
              useNavigationIntent.getState().setIntent({ kind: 'conversation', id: refs.conversationId });
            else if (target === 'code' && refs?.pipelineRunId !== undefined)
              useNavigationIntent.getState().setIntent({ kind: 'pipelineRun', id: refs.pipelineRunId });
            else if (target === 'knowledge' && refs?.ingestJobId !== undefined)
              useNavigationIntent.getState().setIntent({ kind: 'ingestJob', id: refs.ingestJobId });
            else if (target === 'cost') {
              const field = refs?.requestId !== undefined ? 'requestId' : 'pipelineRunId';
              const id = refs?.[field];
              if (id !== undefined) useNavigationIntent.getState().setIntent({ kind: 'ledger', id, field });
            }
            navigate(target);
          }}
          projectId={activeId === null ? null : (projects.find((project) => project.id === activeId)?.id ?? null)}
          projects={projects.map(({ id, name }) => ({ id, name }))}
        />
      </Suspense>
    );
  else if (route === 'cost') {
    const selectedProjectId: ProjectId | null =
      activeId === null ? null : (projects.find((project) => project.id === activeId)?.id ?? null);
    content = (
      <Suspense fallback={<p role="status">{t('cost.loading')}</p>}>
        <CostPage projectId={selectedProjectId} />
      </Suspense>
    );
  } else if (route === 'code')
    content = (
      <Suspense fallback={<p role="status">{t('code.loading')}</p>}>
        <CodePage projectId={projects.find((project) => project.id === activeId)?.id ?? null} />
      </Suspense>
    );
  else if (route === 'gallery')
    content = (
      <Suspense fallback={<p role="status">{t('gallery.loading')}</p>}>
        <GalleryPage
          projectId={activeId === null ? null : (projects.find((project) => project.id === activeId)?.id ?? null)}
          projects={projects}
        />
      </Suspense>
    );
  else if (route === 'settings-api-keys') content = <ApiKeysPage />;
  else if (route === 'settings-theme') content = <ThemePage />;
  else if (route === 'settings-router') content = <RouterSettingsPage />;
  else if (route === 'settings-budget') content = <BudgetSettingsPage />;
  else if (route === 'settings-pricing') content = <PricingSettingsPage projectActive={activeId !== null} />;
  else if (route === 'settings-fx') content = <FxSettingsPage />;
  else if (route === 'settings-vscode') content = <VSCodeSettingsPage />;
  else if (route === 'settings-images') content = <ImagesSettingsPage />;
  else content = <PipelineSettingsPage />;

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <div className="flex min-h-0 flex-1">
        <MainNav navigate={navigate} route={route} />
        <div className="flex min-w-0 flex-1 flex-col">
          <ProjectTabs
            activeId={activeId}
            error={null}
            onActivate={(id) => {
              void activate(id);
            }}
            onAdd={() => {
              setProjectError(null);
              setShowNewProject(true);
            }}
            onClose={(id) => {
              closeProject(id);
            }}
            openIds={visibleOpenIds}
            projects={projects}
          />
          <main className="min-w-0 flex-1 overflow-auto bg-bg p-6 text-text">
            {projectsQuery.isError ? (
              <p className="mb-4 text-danger" role="alert">
                {t('projects.loadError')}
              </p>
            ) : null}
            {projectError !== null && !showNewProject ? (
              <p className="mb-4 text-danger" role="alert">
                {projectError.message}
              </p>
            ) : null}
            {content}
          </main>
        </div>
      </div>
      <StatusBar />
      {showNewProject ? (
        <NewProjectDialog
          error={projectError}
          onCancel={() => {
            setShowNewProject(false);
          }}
          onCreate={createProject}
        />
      ) : null}
    </div>
  );
}
