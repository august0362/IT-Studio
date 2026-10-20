import type { IsoDateTime, Project, ProjectId } from '@itstudio/schemas';

export interface IProjectRepository {
  list(): Promise<readonly Project[]>;
  get(id: ProjectId): Promise<Project | null>;
  getByWorkspaceRoot(workspaceRoot: string): Promise<Project | null>;
  create(project: Project): Promise<void>;
  setArchived(id: ProjectId, archived: boolean): Promise<boolean>;
}

export interface IProjectLifecycleRepository extends IProjectRepository {
  setLastOpenedAt(id: ProjectId, at: IsoDateTime): Promise<void>;
  hasActiveRuns(id: ProjectId): Promise<boolean>;
  delete(id: ProjectId): Promise<boolean>;
}
