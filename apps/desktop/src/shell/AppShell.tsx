import type { AppError, ProcessKind, ProcessRecord, ProjectId } from '@itstudio/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsPage } from '../features/settings/SettingsPage';
import { isSettingsSectionRoute, readLastSettingsRoute } from '../features/settings/settings-sections';
import { StatusBar } from '../components/StatusBar';
import { useRpcQuery } from '../hooks/use-rpc-query';
import { RpcCallError } from '../rpc/rpc-client';
import { useRpcClient } from '../rpc/rpc-context';
import { readActiveProject, readOpenProjects, writeOpenProjects } from '../state/open-projects';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { MainNav, type ShellRoute } from './MainNav';
import { NewProjectDialog } from './NewProjectDialog';
import { ProjectTabs } from './ProjectTabs';
import { ChatPage } from '../features/chat/ChatPage';
import { KnowledgePage } from '../features/knowledge/KnowledgePage';
import { useNavigationIntent } from '../state/navigation-intent';
import { WebChatPage } from '../features/webchat/WebChatPage';
import { createWebChatHost } from '../features/webchat/webchat-host';
import { PIPELINE_STUDIO_ENABLED, PipelineStudioNavButton, ProcessCodePanel } from '../features/pipeline-studio';
import { ProcessesPage } from '../features/processes/ProcessesPage';
import { ProcessViewer } from '../features/processes/ProcessViewer';

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
  if (PIPELINE_STUDIO_ENABLED && hash === 'pipeline-studio') return 'pipeline-studio';
  if (hash === 'settings') return readLastSettingsRoute();
  if (isSettingsSectionRoute(hash)) return hash;
  if (['projects', 'chat', 'webchat', 'code', 'knowledge', 'workflow', 'processes', 'gallery', 'cost'].includes(hash))
    return hash as ShellRoute;
  return readLastSettingsRoute();
}

export function AppShell(): JSX.Element {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const queryClient = useQueryClient();
  const webChatHost = useMemo(() => createWebChatHost(), []);
  const projectsQuery = useRpcQuery('project.list', {});
  const settingsQuery = useRpcQuery('settings.get', {});
  const [route, setRoute] = useState<ShellRoute>(initialRoute);
  const [openIds, setOpenIds] = useState<string[]>(readOpenProjects);
  const [activeSelection, setActiveSelection] = useState<
    { readonly kind: 'project'; readonly id: string } | { readonly kind: 'all' } | undefined
  >(() => {
    const id = readActiveProject();
    return id === undefined ? undefined : id === null ? { kind: 'all' } : { kind: 'project', id };
  });
  const [showNewProject, setShowNewProject] = useState(false);
  const [webChatSuspended, setWebChatSuspended] = useState(false);
  const [projectError, setProjectError] = useState<AppError | null>(null);
  const [viewedProcess, setViewedProcess] = useState<ProcessRecord | null>(null);
  const [processKind, setProcessKind] = useState<ProcessKind | ''>('');
  const navigationRevision = useRef(0);
  const restoredActive = useRef(false);
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
        ? projects.some((project) => project.id === activeSelection.id)
          ? activeSelection.id
          : (validOpenIds[0] ?? null)
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
    if (projectsQuery.isSuccess && settingsQuery.isSuccess) writeOpenProjects(visibleOpenIds, activeId);
  }, [visibleOpenIds, activeId, projectsQuery.isSuccess, settingsQuery.isSuccess]);

  useEffect(() => {
    if (!projectsQuery.isSuccess || !settingsQuery.isSuccess || restoredActive.current) return;
    restoredActive.current = true;
    const project = projects.find((item) => item.id === activeId);
    if (project === undefined || project.id === configuredActiveId) return;
    void rpc
      .call('project.setActive', { projectId: project.id })
      .then(() => queryClient.invalidateQueries({ queryKey: ['settings.get', {}] }))
      .catch((cause: unknown) => {
        setProjectError(asAppError(cause));
      });
  }, [activeId, configuredActiveId, projects, projectsQuery.isSuccess, queryClient, rpc, settingsQuery.isSuccess]);
  const navigate = useCallback(
    (target: ShellRoute): void => {
      const next = target === 'settings' ? readLastSettingsRoute() : target;
      const revision = ++navigationRevision.current;
      const apply = (): void => {
        if (revision !== navigationRevision.current) return;
        if (next === 'processes') setProcessKind('');
        setRoute(next);
        setViewedProcess(null);
        setWebChatSuspended(false);
        window.history.replaceState(null, '', `#${next}`);
      };
      if (route === 'webchat' && next !== 'webchat') {
        setWebChatSuspended(true);
        void webChatHost
          .closeAll()
          .then(apply)
          .catch((cause: unknown) => {
            if (revision !== navigationRevision.current) return;
            setProjectError(asAppError(cause));
            setWebChatSuspended(false);
            window.history.replaceState(null, '', `#${route}`);
          });
      } else apply();
    },
    [route, webChatHost],
  );

  useEffect(() => {
    const listener = (): void => {
      navigate(initialRoute());
    };
    window.addEventListener('hashchange', listener);
    return () => {
      window.removeEventListener('hashchange', listener);
    };
  }, [navigate]);

  async function openNewProjectDialog(): Promise<void> {
    setProjectError(null);
    if (route === 'webchat') {
      setWebChatSuspended(true);
      try {
        await webChatHost.setVisible(false);
      } catch (cause: unknown) {
        setProjectError(asAppError(cause));
        setWebChatSuspended(false);
        return;
      }
    }
    setShowNewProject(true);
  }

  async function activate(id: string | null): Promise<boolean> {
    setProjectError(null);
    if (id !== null) {
      const project = projects.find((item) => item.id === id);
      if (project === undefined) return false;
      try {
        await rpc.call('project.setActive', { projectId: project.id });
        await queryClient.invalidateQueries({ queryKey: ['settings.get', {}] });
        await queryClient.invalidateQueries({ queryKey: ['project.list', {}] });
      } catch (cause: unknown) {
        setProjectError(asAppError(cause));
        return false;
      }
    }
    setActiveSelection(id === null ? { kind: 'all' } : { kind: 'project', id });
    if (id !== null) setOpenIds((current) => (current.includes(id) ? current : [...current, id]));
    return true;
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
      setWebChatSuspended(false);
    } catch (cause: unknown) {
      setProjectError(asAppError(cause));
    }
  }

  function closeProject(id: string): void {
    const remaining = visibleOpenIds.filter((openId) => openId !== id);
    setOpenIds(remaining);
    if (activeId === id) setActiveSelection({ kind: 'all' });
  }

  async function openProcessRef(record: ProcessRecord): Promise<void> {
    if (!record.ref) return;
    if (record.projectId && !(await activate(record.projectId))) return;
    const { type, id } = record.ref;
    if (type === 'conversation') {
      useNavigationIntent.getState().setIntent({ kind: 'conversation', id });
      navigate('chat');
    } else if (type === 'pipeline_run') {
      useNavigationIntent.getState().setIntent({ kind: 'pipelineRun', id });
      navigate('code');
    } else if (type === 'ingest_job') {
      useNavigationIntent.getState().setIntent({ kind: 'ingestJob', id });
      navigate('knowledge');
    } else if (type === 'image') {
      useNavigationIntent.getState().setIntent({ kind: 'image', id });
      navigate('gallery');
    } else if (type === 'price_run') navigate('settings-pricing');
    else navigate('webchat');
  }

  if (viewedProcess !== null) {
    return (
      <Suspense
        fallback={
          <div className="fixed inset-0" style={{ background: 'black', color: 'white' }} role="status">
            {t('pipelineStudio.loading')}
          </div>
        }
      >
        <ProcessViewer
          key={viewedProcess.id}
          initial={viewedProcess}
          onBack={() => {
            setViewedProcess(null);
          }}
          onOpenRef={(record) => {
            void openProcessRef(record);
          }}
          renderRichPanel={
            PIPELINE_STUDIO_ENABLED && viewedProcess.kind === 'code_pipeline'
              ? (props) => (
                  <Suspense fallback={<p role="status">{t('pipelineStudio.loading')}</p>}>
                    <ProcessCodePanel {...props} />
                  </Suspense>
                )
              : undefined
          }
        />
      </Suspense>
    );
  }

  let content: JSX.Element;
  if (route === 'processes' || (PIPELINE_STUDIO_ENABLED && route === 'pipeline-studio'))
    content = (
      <ProcessesPage
        key={`${route}:${activeId ?? 'all'}:${processKind}`}
        projectId={projects.find((project) => project.id === activeId)?.id ?? null}
        projects={projects}
        initialKind={route === 'pipeline-studio' ? 'code_pipeline' : processKind}
        onOpen={setViewedProcess}
      />
    );
  else if (route === 'projects')
    content = (
      <ProjectsPage
        onDeleted={closeProject}
        onNew={() => {
          void openNewProjectDialog();
        }}
        onOpen={async (id) => {
          if (await activate(id)) navigate('chat');
        }}
      />
    );
  else if (route === 'chat')
    content = (
      <ChatPage onNavigate={navigate} projectId={projects.find((project) => project.id === activeId)?.id ?? null} />
    );
  else if (route === 'webchat')
    content = (
      <WebChatPage
        projectId={projects.find((project) => project.id === activeId)?.id ?? null}
        host={webChatHost}
        layoutRevision={`${String(projectsQuery.isError)}:${projectError?.message ?? ''}:${String(showNewProject)}`}
        onSettings={() => {
          navigate('settings-web-chat');
        }}
        suspended={webChatSuspended}
      />
    );
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
  else
    content = (
      <SettingsPage
        section={isSettingsSectionRoute(route) ? route : readLastSettingsRoute()}
        navigate={navigate}
        projectActive={activeId !== null}
        labs={
          PIPELINE_STUDIO_ENABLED ? (
            <PipelineStudioNavButton
              onOpen={() => {
                navigate('processes');
                setProcessKind('code_pipeline');
              }}
            />
          ) : null
        }
      />
    );

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
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
              void openNewProjectDialog();
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
      <StatusBar
        onProcesses={() => {
          navigate('processes');
        }}
      />
      {showNewProject ? (
        <NewProjectDialog
          error={projectError}
          onCancel={() => {
            setShowNewProject(false);
            setWebChatSuspended(false);
          }}
          onCreate={createProject}
        />
      ) : null}
    </div>
  );
}
