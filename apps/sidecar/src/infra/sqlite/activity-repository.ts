import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { ActivityEvent, ProjectId, WorkflowModuleId } from '@itstudio/schemas';
import type { AppDatabase } from './database.js';
import { activityEvents } from './schema.js';
import { activityEventSchema } from '../../validation/workflow.js';

export class ActivityRepository {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  insert(event: ActivityEvent): Promise<void> {
    this.db
      .insert(activityEvents)
      .values({
        id: event.id,
        projectId: event.projectId,
        moduleId: event.moduleId,
        occurredAt: event.ts,
        eventJson: JSON.stringify(event),
      })
      .run();
    this.db
      .delete(activityEvents)
      .where(
        and(
          event.projectId === null ? isNull(activityEvents.projectId) : eq(activityEvents.projectId, event.projectId),
          lt(activityEvents.occurredAt, new Date(Date.parse(event.ts) - 7 * 24 * 60 * 60 * 1000).toISOString()),
        ),
      )
      .run();
    this.pruneExcess(event.projectId);
    return Promise.resolve();
  }

  query(
    projectId: ProjectId | null,
    limit: number,
    before?: string,
    moduleId?: WorkflowModuleId,
  ): readonly ActivityEvent[] {
    const filters = projectId === null ? [] : [eq(activityEvents.projectId, projectId)];
    if (before !== undefined) filters.push(lt(activityEvents.occurredAt, before));
    if (moduleId !== undefined) filters.push(eq(activityEvents.moduleId, moduleId));
    return this.db
      .select()
      .from(activityEvents)
      .where(and(...filters))
      .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.id))
      .limit(limit)
      .all()
      .map((row) => activityEventSchema.parse(JSON.parse(row.eventJson) as unknown));
  }

  since(projectId: ProjectId | null, since: string): readonly ActivityEvent[] {
    const condition =
      projectId === null
        ? gt(activityEvents.occurredAt, since)
        : and(eq(activityEvents.projectId, projectId), gt(activityEvents.occurredAt, since));
    return this.db
      .select()
      .from(activityEvents)
      .where(condition)
      .all()
      .map((row) => activityEventSchema.parse(JSON.parse(row.eventJson) as unknown));
  }

  prune(now: Date): void {
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    this.db.delete(activityEvents).where(lt(activityEvents.occurredAt, cutoff)).run();
    const projects = this.db.selectDistinct({ projectId: activityEvents.projectId }).from(activityEvents).all();
    for (const project of projects) {
      this.pruneExcess(project.projectId);
    }
  }

  private pruneExcess(projectId: string | null): void {
    const condition = projectId === null ? isNull(activityEvents.projectId) : eq(activityEvents.projectId, projectId);
    const cutoff = this.db
      .select({ id: activityEvents.id, occurredAt: activityEvents.occurredAt })
      .from(activityEvents)
      .where(condition)
      .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.id))
      .limit(1)
      .offset(19_999)
      .get();
    if (cutoff === undefined) return;
    this.db
      .delete(activityEvents)
      .where(
        and(
          condition,
          or(
            lt(activityEvents.occurredAt, cutoff.occurredAt),
            and(eq(activityEvents.occurredAt, cutoff.occurredAt), lt(activityEvents.id, cutoff.id)),
          ),
        ),
      )
      .run();
  }
}
