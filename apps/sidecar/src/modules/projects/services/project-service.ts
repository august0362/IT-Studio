import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { AppError, Project, ProjectId, Result } from '@itstudio/schemas';
import type { IClock } from '../../../kernel/infra/clock.js';
import type { IIdGenerator } from '../../../kernel/infra/id.js';
import type { IProjectLifecycleRepository } from '../../../kernel/ports/project-repository.js';
import type { SettingsService } from '../../settings/index.js';
import { projectSchema } from '../../../kernel/validation/projects.js';
import { isoDateTimeSchema } from '../../../kernel/validation/brand.js';
import { resolveSafe } from '../../../kernel/domain/path-guard.js';
import type { IFileSystem } from '../../../kernel/ports/file-system.js';
import type { IVectorStore } from '../../../kernel/ports/vector-store.js';
import type { Logger } from 'pino';

export interface ProjectServiceDependencies {
  readonly repository: IProjectLifecycleRepository;
  readonly settings: SettingsService;
  readonly ids: IIdGenerator;
  readonly clock: IClock;
  readonly fileSystem: IFileSystem;
  readonly vectors: Pick<IVectorStore, 'dropTable'>;
  readonly dataDir: string;
  readonly logger: Pick<Logger, 'warn'>;
  readonly pipelineBusy?: (projectId: ProjectId) => boolean;
  readonly forgetActivity?: (projectId: ProjectId) => Promise<void>;
}

export class ProjectService {
  private readonly repository: IProjectLifecycleRepository;
  private readonly settings: SettingsService;
  private readonly ids: IIdGenerator;
  private readonly clock: IClock;
  private readonly deps: ProjectServiceDependencies;
  private readonly deleting = new Set<ProjectId>();

  constructor(dependencies: ProjectServiceDependencies) {
    this.deps = dependencies;
    this.repository = dependencies.repository;
    this.settings = dependencies.settings;
    this.ids = dependencies.ids;
    this.clock = dependencies.clock;
  }

  async list(): Promise<Result<readonly Project[]>> {
    return { ok: true, value: await this.repository.list() };
  }

  async create(name: string, workspaceRoot: string): Promise<Result<Project>> {
    if (!isAbsolute(workspaceRoot)) return projectError('VALIDATION', 'Workspace path must be absolute');
    const root = resolve(workspaceRoot);
    if (dirname(root) === root) return projectError('VALIDATION', 'Filesystem roots cannot be projects');
    let details;
    try {
      details = await stat(root);
    } catch {
      return projectError('NOT_FOUND', 'Workspace path does not exist');
    }
    if (!details.isDirectory()) return projectError('VALIDATION', 'Workspace path must be a directory');
    if (await this.repository.getByWorkspaceRoot(root))
      return projectError('CONFLICT', 'Workspace is already registered');
    const project = projectSchema.parse({
      id: this.ids.uuid(),
      name,
      workspaceRoot: root,
      createdAt: this.clock.now().toISOString(),
      archived: false,
    });
    await this.repository.create(project);
    return { ok: true, value: project };
  }

  async setActive(projectId: ProjectId): Promise<Result<Project>> {
    if (this.isDeleting(projectId)) return projectError('CONFLICT', 'Project deletion is in progress');
    const project = await this.repository.get(projectId);
    if (project === null) return projectError('NOT_FOUND', 'Project was not found');
    const update = await this.settings.update({ activeProjectId: projectId });
    if (!update.ok) return update;
    const lastOpenedAt = isoDateTimeSchema.parse(this.clock.now().toISOString());
    await this.repository.setLastOpenedAt(projectId, lastOpenedAt);
    return { ok: true, value: { ...project, lastOpenedAt } };
  }

  isDeleting(projectId: ProjectId): boolean {
    return this.deleting.has(projectId);
  }

  async delete(projectId: ProjectId): Promise<Result<{ readonly deleted: boolean }>> {
    if (this.isDeleting(projectId)) return projectError('CONFLICT', 'Project deletion is in progress');
    this.deleting.add(projectId);
    try {
      const project = await this.repository.get(projectId);
      if (project === null) return projectError('NOT_FOUND', 'Project was not found');
      if (this.deps.pipelineBusy?.(projectId) || (await this.repository.hasActiveRuns(projectId)))
        return projectError('CONFLICT', 'Stop the running pipeline before deleting this project');
      const files = await this.deleteImages(project);
      if (!files.ok) return files;
      const vectors = await this.deps.vectors.dropTable(projectId);
      if (!vectors.ok) return vectors;
      const settings = await this.settings.clearActiveProject(projectId);
      if (!settings.ok) return settings;
      await this.deps.forgetActivity?.(projectId);
      return { ok: true, value: { deleted: await this.repository.delete(projectId) } };
    } catch {
      this.deps.logger.warn({ svc: 'projects', projectId }, 'Project deletion failed');
      return projectError('INTERNAL', 'Project data could not be removed; retry deletion');
    } finally {
      this.deleting.delete(projectId);
    }
  }

  private async deleteImages(project: Project): Promise<Result<void>> {
    const fs = this.deps.fileSystem;
    const folder = await resolveSafe(this.deps.dataDir, `images/${project.id}`, ['images'], fs);
    if (!folder.ok) return folder;
    const exists = await fs.exists(folder.value);
    if (!exists.ok) return exists;
    if (!exists.value) return { ok: true, value: undefined };
    const root = await fs.realpath(project.workspaceRoot);
    const realFolder = await fs.realpath(folder.value);
    if (!realFolder.ok) return realFolder;
    const workspaceRoot = root.ok ? root.value : resolve(project.workspaceRoot);
    const isWorkspacePath = (path: string): boolean => {
      const fromWorkspace = relative(workspaceRoot, path);
      return (
        fromWorkspace === '' ||
        (fromWorkspace !== '..' && !fromWorkspace.startsWith(`..${sep}`) && !isAbsolute(fromWorkspace))
      );
    };
    if (isWorkspacePath(realFolder.value))
      return projectError('CONFLICT', 'Stored images overlap the project workspace');
    const files = await fs.readdir(folder.value);
    if (!files.ok) return files;
    for (const name of files.value) {
      const path = await resolveSafe(this.deps.dataDir, `images/${project.id}/${name}`, ['images'], fs);
      if (!path.ok) return path;
      const real = await fs.realpath(path.value);
      if (!real.ok) return real;
      if (isWorkspacePath(real.value)) return projectError('CONFLICT', 'Stored image overlaps the project workspace');
      const removed = await fs.unlink(path.value);
      if (!removed.ok) return removed;
    }
    const removed = await fs.rmdirIfEmpty(join(this.deps.dataDir, 'images', project.id));
    return removed.ok ? { ok: true, value: undefined } : removed;
  }
}

function projectError(code: AppError['code'], message: string): Result<never> {
  return {
    ok: false,
    error: { code, message, remediation: ['Check the project details and try again.'], retryable: false },
  };
}
