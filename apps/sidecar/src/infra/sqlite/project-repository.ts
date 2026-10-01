import { eq } from 'drizzle-orm';
import type { Project } from '@itstudio/schemas';
import type { AppDatabase } from './database.js';
import { projects } from './schema.js';
import type { IProjectRepository } from '../../ports/project-repository.js';
import { projectSchema } from '../../validation/projects.js';

export class ProjectRepository implements IProjectRepository {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  list(): Promise<readonly Project[]> {
    return Promise.resolve(this.db.select().from(projects).all().map(toProject));
  }

  get(id: Project['id']): Promise<Project | null> {
    const row = this.db.select().from(projects).where(eq(projects.id, id)).get();
    return Promise.resolve(row === undefined ? null : toProject(row));
  }

  getByWorkspaceRoot(workspaceRoot: string): Promise<Project | null> {
    const row = this.db.select().from(projects).where(eq(projects.workspaceRoot, workspaceRoot)).get();
    return Promise.resolve(row === undefined ? null : toProject(row));
  }

  create(project: Project): Promise<void> {
    this.db
      .insert(projects)
      .values({
        id: project.id,
        name: project.name,
        workspaceRoot: project.workspaceRoot,
        createdAt: project.createdAt,
        archived: project.archived ? 1 : 0,
      })
      .run();
    return Promise.resolve();
  }

  setArchived(id: Project['id'], archived: boolean): Promise<boolean> {
    const result = this.db
      .update(projects)
      .set({ archived: archived ? 1 : 0 })
      .where(eq(projects.id, id))
      .run();
    return Promise.resolve(result.changes > 0);
  }
}

function toProject(row: typeof projects.$inferSelect): Project {
  return projectSchema.parse({
    id: row.id,
    name: row.name,
    workspaceRoot: row.workspaceRoot,
    createdAt: row.createdAt,
    archived: row.archived === 1,
  });
}
