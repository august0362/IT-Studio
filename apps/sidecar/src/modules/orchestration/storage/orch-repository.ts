import { desc, eq } from 'drizzle-orm';
import type { OrchAttempt, OrchRun } from '@itstudio/schemas';
import type { AppDatabase } from '../../../infra/sqlite/database.js';
import { orchAttempts, orchEvents, orchRuns, orchTasks } from '../../../infra/sqlite/schema.js';

export class OrchRepository {
  private readonly db: AppDatabase;
  constructor(db: AppDatabase) {
    this.db = db;
  }
  save(run: OrchRun, attempts: readonly OrchAttempt[] = []): void {
    this.db.transaction((tx) => {
      tx.insert(orchRuns)
        .values({
          id: run.id,
          projectId: run.projectId,
          state: run.state,
          dataJson: JSON.stringify(run),
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        })
        .onConflictDoUpdate({
          target: orchRuns.id,
          set: { state: run.state, dataJson: JSON.stringify(run), updatedAt: run.updatedAt },
        })
        .run();
      tx.delete(orchTasks).where(eq(orchTasks.runId, run.id)).run();
      if (run.tasks.length > 0)
        tx.insert(orchTasks)
          .values(
            run.tasks.map((task) => ({
              id: task.id,
              runId: run.id,
              state: task.state,
              dataJson: JSON.stringify(task),
            })),
          )
          .run();
      const insertedAttempts = attempts.filter(
        (attempt) =>
          tx
            .insert(orchAttempts)
            .values({
              id: attempt.id,
              runId: run.id,
              taskId: attempt.taskId,
              state: attempt.state,
              dataJson: JSON.stringify(attempt),
            })
            .onConflictDoNothing()
            .returning({ id: orchAttempts.id })
            .all().length > 0,
      );
      if (insertedAttempts.length > 0)
        tx.insert(orchEvents)
          .values(
            insertedAttempts.map((attempt) => ({
              runId: run.id,
              type: 'attempt',
              dataJson: JSON.stringify({ type: 'attempt', runId: run.id, attempt }),
              createdAt: attempt.endedAt ?? attempt.startedAt,
            })),
          )
          .run();
      tx.insert(orchEvents)
        .values({
          runId: run.id,
          type: 'run',
          dataJson: JSON.stringify({ type: 'run', run }),
          createdAt: run.updatedAt,
        })
        .run();
    });
  }
  get(id: string): OrchRun | undefined {
    const row = this.db.select({ dataJson: orchRuns.dataJson }).from(orchRuns).where(eq(orchRuns.id, id)).get();
    return row === undefined ? undefined : (JSON.parse(row.dataJson) as OrchRun);
  }
  list(projectId?: string, limit = 100): readonly OrchRun[] {
    const rows = (
      projectId === undefined
        ? this.db.select({ dataJson: orchRuns.dataJson }).from(orchRuns)
        : this.db.select({ dataJson: orchRuns.dataJson }).from(orchRuns).where(eq(orchRuns.projectId, projectId))
    )
      .orderBy(desc(orchRuns.updatedAt))
      .limit(limit)
      .all();
    return rows.map((row) => JSON.parse(row.dataJson) as OrchRun);
  }
  attempts(runId: string): readonly OrchAttempt[] {
    return this.db
      .select({ dataJson: orchAttempts.dataJson })
      .from(orchAttempts)
      .where(eq(orchAttempts.runId, runId))
      .all()
      .map((row) => JSON.parse(row.dataJson) as OrchAttempt);
  }
}
