import { desc, eq } from 'drizzle-orm';
import type { PipelineRun, PipelineRunId, ProjectId } from '@itstudio/schemas';
import type { AppDatabase } from './database.js';
import { pipelineRuns } from './schema.js';
import { pipelineRunSchema } from '../../validation/pipeline.js';

export interface IPipelineRepository {
  save(run: PipelineRun): Promise<void>;
  get(id: PipelineRunId): Promise<PipelineRun | null>;
  list(projectId: ProjectId, limit: number): Promise<readonly PipelineRun[]>;
}

export class PipelineRepository implements IPipelineRepository {
  private readonly db: AppDatabase;
  constructor(db: AppDatabase) {
    this.db = db;
  }

  save(run: PipelineRun): Promise<void> {
    this.db
      .insert(pipelineRuns)
      .values({
        id: run.id,
        projectId: run.projectId,
        prompt: run.prompt,
        stage: run.stage,
        artifactsJson: JSON.stringify(run),
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? null,
      })
      .onConflictDoUpdate({
        target: pipelineRuns.id,
        set: { stage: run.stage, artifactsJson: JSON.stringify(run), finishedAt: run.finishedAt ?? null },
      })
      .run();
    return Promise.resolve();
  }

  get(id: PipelineRunId): Promise<PipelineRun | null> {
    const row = this.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, id)).get();
    return Promise.resolve(row === undefined ? null : parseRun(row.artifactsJson));
  }

  list(projectId: ProjectId, limit: number): Promise<readonly PipelineRun[]> {
    const rows = this.db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.projectId, projectId))
      .orderBy(desc(pipelineRuns.startedAt))
      .limit(limit)
      .all();
    return Promise.resolve(rows.map((row) => parseRun(row.artifactsJson)));
  }
}

function parseRun(json: string): PipelineRun {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch (cause) {
    throw new Error('Stored pipeline run JSON is invalid', { cause });
  }
  return pipelineRunSchema.parse(value);
}
