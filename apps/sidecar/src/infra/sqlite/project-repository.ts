import { and, desc, eq, notInArray } from 'drizzle-orm';
import { PipelineStage, type IsoDateTime, type Project } from '@itstudio/schemas';
import type { AppDatabase } from './database.js';
import { activityEvents, pipelineRuns, projects } from './schema.js';
import type { IProjectLifecycleRepository } from '../../ports/project-repository.js';
import { projectSchema } from '../../validation/projects.js';

export class ProjectRepository implements IProjectLifecycleRepository {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  list(): Promise<readonly Project[]> {
    return Promise.resolve(
      this.db
        .select()
        .from(projects)
        .orderBy(desc(projects.lastOpenedAt), desc(projects.createdAt))
        .all()
        .map(toProject),
    );
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
        lastOpenedAt: project.lastOpenedAt ?? null,
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

  setLastOpenedAt(id: Project['id'], at: IsoDateTime): Promise<void> {
    this.db.update(projects).set({ lastOpenedAt: at }).where(eq(projects.id, id)).run();
    return Promise.resolve();
  }

  hasActiveRuns(id: Project['id']): Promise<boolean> {
    return Promise.resolve(
      this.db
        .select({ id: pipelineRuns.id })
        .from(pipelineRuns)
        .where(
          and(
            eq(pipelineRuns.projectId, id),
            notInArray(pipelineRuns.stage, [
              PipelineStage.COMPLETED,
              PipelineStage.CANCELLED,
              PipelineStage.FAILED,
              PipelineStage.ROLLED_BACK,
            ]),
          ),
        )
        .get() !== undefined,
    );
  }

  delete(id: Project['id']): Promise<boolean> {
    return Promise.resolve(
      this.db.transaction((tx) => {
        tx.delete(activityEvents).where(eq(activityEvents.projectId, id)).run();
        return tx.delete(projects).where(eq(projects.id, id)).run().changes > 0;
      }),
    );
  }
}

function toProject(row: typeof projects.$inferSelect): Project {
  return projectSchema.parse({
    id: row.id,
    name: row.name,
    workspaceRoot: row.workspaceRoot,
    createdAt: row.createdAt,
    ...(row.lastOpenedAt === null ? {} : { lastOpenedAt: row.lastOpenedAt }),
    archived: row.archived === 1,
  });
}
