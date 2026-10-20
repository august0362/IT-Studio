import { describe, expect, it } from 'vitest';
import { PipelineRepository } from '../infra/sqlite/pipeline-repository.js';
import { openDatabase } from '../infra/sqlite/database.js';
import { projects } from '../infra/sqlite/schema.js';
import { pipelineEventSchema, pipelineRunSchema, clarificationQuestionSchema } from './pipeline.js';

const question = {
  id: 'storage',
  question: 'Where?',
  why: 'Changes the API.',
  options: [
    { id: 'local', label: 'Local' },
    { id: 'cloud', label: 'Cloud' },
  ],
  recommendedOptionId: 'local',
  recommendationReason: 'Works offline.',
};
const legacyRun = {
  id: '00000000-0000-4000-8000-000000000001',
  projectId: '00000000-0000-4000-8000-000000000002',
  prompt: 'Build storage',
  stage: 'specifying',
  roleAssignment: { pm: [], coder: [], reviewer: [] },
  coderOutputs: [],
  verdicts: [],
  fixAttempts: 0,
  cost: { microUsd: 0, vnd: 0, usdText: '$0', vndText: '0', fxAsOf: '2026-10-15T00:00:00.000Z' },
  startedAt: '2026-10-15T00:00:00.000Z',
};

describe('PSTUDIO-01 persistence contracts', () => {
  it('round-trips waiting questions and answers through artifacts JSON and loads old rows', async () => {
    const database = openDatabase(':memory:');
    try {
      const repository = new PipelineRepository(database.db);
      database.db
        .insert(projects)
        .values({ id: legacyRun.projectId, name: 'Test', workspaceRoot: 'C:/test', createdAt: legacyRun.startedAt })
        .run();
      const old = pipelineRunSchema.parse(legacyRun);
      await repository.save(old);
      expect((await repository.get(old.id))?.clarifications).toBeUndefined();
      const waiting = pipelineRunSchema.parse({ ...legacyRun, stage: 'clarifying', clarifications: [question] });
      await repository.save(waiting);
      expect(await repository.get(waiting.id)).toEqual(waiting);
      const answered = pipelineRunSchema.parse({
        ...legacyRun,
        clarifications: [{ ...question, answer: { optionId: 'local', by: 'auto', at: legacyRun.startedAt } }],
      });
      await repository.save(answered);
      expect(await repository.get(answered.id)).toEqual(answered);
      expect(pipelineEventSchema.parse({ type: 'clarification', runId: old.id, status: 'answered' })).toMatchObject({
        status: 'answered',
      });
    } finally {
      database.client.close();
    }
  });

  it.each([
    { optionId: 'unknown', by: 'user', at: legacyRun.startedAt },
    { freeText: ' ', by: 'user', at: legacyRun.startedAt },
    { freeText: 'x'.repeat(2001), by: 'user', at: legacyRun.startedAt },
  ])('rejects invalid persisted answers (%#)', (answer) => {
    expect(clarificationQuestionSchema.safeParse({ ...question, answer }).success).toBe(false);
  });
});
