import { WorkflowModuleId, type ActivityEvent } from '@itstudio/schemas';
import { describe, expect, it } from 'vitest';
import { activityEventIdSchema, isoDateTimeSchema, projectIdSchema } from '../../validation/brand.js';
import { openDatabase } from './database.js';
import { ActivityRepository } from './activity-repository.js';
import { activityEvents } from './schema.js';

const projectId = projectIdSchema.parse('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const now = new Date('2026-10-03T12:00:00.000Z');

function event(index: number, ts: string): ActivityEvent {
  return {
    id: activityEventIdSchema.parse(`10000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
    projectId,
    moduleId: WorkflowModuleId.CHAT,
    kind: 'info',
    summary: 'test event',
    refs: {},
    ts: isoDateTimeSchema.parse(ts),
  };
}

describe('ActivityRepository', () => {
  it('prunes a project to 20,000 recent rows in real SQLite', () => {
    const database = openDatabase(':memory:');
    const repository = new ActivityRepository(database.db);
    const rows = Array.from({ length: 20_005 }, (_, index) => {
      const occurredAt = new Date(now.getTime() - (20_004 - index) * 1000).toISOString();
      const item = event(index, occurredAt);
      return {
        id: item.id,
        projectId: item.projectId,
        moduleId: item.moduleId,
        occurredAt: item.ts,
        eventJson: JSON.stringify(item),
      };
    });
    for (let offset = 0; offset < rows.length; offset += 500) {
      database.db
        .insert(activityEvents)
        .values(rows.slice(offset, offset + 500))
        .run();
    }

    repository.prune(now);

    const remaining = database.db.select().from(activityEvents).all();
    expect(remaining).toHaveLength(20_000);
    expect(remaining.some((row) => row.id === event(20_004, now.toISOString()).id)).toBe(true);
    expect(remaining.some((row) => row.id === event(0, new Date(now.getTime() - 20_004_000).toISOString()).id)).toBe(
      false,
    );
    database.client.close();
  });

  it('deletes rows older than seven days and retains the exact cutoff in real SQLite', () => {
    const database = openDatabase(':memory:');
    const repository = new ActivityRepository(database.db);
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const rows = [
      event(30_000, new Date(cutoff.getTime() - 1).toISOString()),
      event(30_001, cutoff.toISOString()),
      event(30_002, new Date(cutoff.getTime() + 1).toISOString()),
    ];
    database.db
      .insert(activityEvents)
      .values(
        rows.map((item) => ({
          id: item.id,
          projectId: item.projectId,
          moduleId: item.moduleId,
          occurredAt: item.ts,
          eventJson: JSON.stringify(item),
        })),
      )
      .run();

    repository.prune(now);

    expect(
      new Set(
        database.db
          .select({ id: activityEvents.id })
          .from(activityEvents)
          .all()
          .map((row) => row.id),
      ),
    ).toEqual(new Set([rows[1]?.id, rows[2]?.id]));
    database.client.close();
  });
});
