import { ProjectRepository } from '../../kernel/infra/sqlite/project-repository.js';
import type { ModuleContext } from '../../kernel/module-context.js';
import type { SettingsService } from '../settings/index.js';
import { ProjectContextService } from './services/project-context.js';
import { ProjectService, type ProjectServiceDependencies } from './services/project-service.js';

export interface ProjectsModuleDependencies {
  readonly settings: SettingsService;
  readonly vectors: ProjectServiceDependencies['vectors'];
  /** Pipeline and workflow state is owned by modules built after this one; these are called lazily. */
  readonly pipelineBusy: NonNullable<ProjectServiceDependencies['pipelineBusy']>;
  readonly forgetActivity: NonNullable<ProjectServiceDependencies['forgetActivity']>;
}

export function createProjectsModule(ctx: ModuleContext, deps: ProjectsModuleDependencies) {
  const repository = new ProjectRepository(ctx.db);
  const context = new ProjectContextService(ctx.fileSystem);
  const service = new ProjectService({
    repository,
    settings: deps.settings,
    ids: ctx.ids,
    clock: ctx.clock,
    fileSystem: ctx.fileSystem,
    vectors: deps.vectors,
    dataDir: ctx.filesDir,
    logger: ctx.logger,
    pipelineBusy: deps.pipelineBusy,
    forgetActivity: deps.forgetActivity,
  });
  return { repository, context, service };
}

export type ProjectsModule = ReturnType<typeof createProjectsModule>;
export { ProjectContextService } from './services/project-context.js';
export { registerProjectsRpc } from './rpc.js';
