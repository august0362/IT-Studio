import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { AppError, Project, ProjectId, Result } from '@itstudio/schemas';
import type { IClock } from '../infra/clock.js';
import type { IIdGenerator } from '../infra/id.js';
import type { IProjectRepository } from '../ports/project-repository.js';
import type { SettingsService } from './settings-service.js';
import { projectSchema } from '../validation/projects.js';

export interface ProjectServiceDependencies {
  readonly repository: IProjectRepository;
  readonly settings: SettingsService;
  readonly ids: IIdGenerator;
  readonly clock: IClock;
}

export class ProjectService {
  private readonly repository: IProjectRepository;
  private readonly settings: SettingsService;
  private readonly ids: IIdGenerator;
  private readonly clock: IClock;

  constructor(dependencies: ProjectServiceDependencies) {
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
    const project = await this.repository.get(projectId);
    if (project === null) return projectError('NOT_FOUND', 'Project was not found');
    const update = await this.settings.update({ activeProjectId: projectId });
    if (!update.ok) return update;
    return { ok: true, value: project };
  }
}

function projectError(code: AppError['code'], message: string): Result<never> {
  return {
    ok: false,
    error: { code, message, remediation: ['Check the project details and try again.'], retryable: false },
  };
}
