import { ModelCapability, type LlmRequest, type LlmResponse, type Result } from '@itstudio/schemas';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import {
  conversationIdSchema,
  isoDateTimeSchema,
  llmRequestIdSchema,
  messageIdSchema,
  microUsdSchema,
  pipelineRunIdSchema,
  projectIdSchema,
} from '../validation/brand.js';
import { modelKeySchema } from '../validation/common.js';
import { RoleCaller } from './role-caller.js';

const projectId = projectIdSchema.parse('00000000-0000-4000-8000-000000000001');
const pipelineRunId = pipelineRunIdSchema.parse('00000000-0000-4000-8000-000000000002');
const ladder = [modelKeySchema.parse('openai/model-a')];
const fixedUuid = '00000000-0000-4000-8000-000000000003';

function response(text: string): LlmResponse {
  return {
    requestId: llmRequestIdSchema.parse(fixedUuid),
    modelKey: ladder[0] ?? modelKeySchema.parse('openai/model-a'),
    message: {
      id: messageIdSchema.parse(fixedUuid),
      conversationId: conversationIdSchema.parse(fixedUuid),
      role: 'assistant',
      parts: [{ type: 'text', text }],
      createdAt: isoDateTimeSchema.parse('2026-10-02T00:00:00.000Z'),
    },
    usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
    costMicroUsd: microUsdSchema.parse(0),
    finishReason: 'stop',
    attempts: [],
    latencyMs: 1,
  };
}

function harness(answers: readonly string[]) {
  const requests: LlmRequest[] = [];
  const dispatch = vi.fn((request: LlmRequest): Promise<Result<LlmResponse>> => {
    requests.push(request);
    const answer = answers[requests.length - 1] ?? '';
    return Promise.resolve({ ok: true, value: response(answer) });
  });
  const logger = pino({ level: 'silent' });
  const caller = new RoleCaller({
    router: { dispatch },
    logger,
    ids: { uuid: () => fixedUuid },
    now: () => new Date('2026-10-02T00:00:00.000Z'),
  });
  return { caller, requests, dispatch, logger };
}

const taskSpec = {
  title: 'Task',
  userStory: 'As a user',
  acceptanceCriteria: [],
  allowedPaths: [],
  contracts: '',
  constraints: [],
  testPlan: [],
  outOfScope: [],
};
const coderOutput = { summary: 'Done', operations: [], assumptions: [] };

describe('RoleCaller', () => {
  it('accepts valid JSON and extracts an object from surrounding prose and fences', async () => {
    const h = harness([
      'Here is {not JSON}; the result is:\n```json\n{"title":"T","userStory":"S","acceptanceCriteria":[],"allowedPaths":[],"contracts":"","constraints":[],"testPlan":[],"outOfScope":[]}\n```',
    ]);
    const result = await h.caller.call(
      'pm',
      { prompt: 'Build it', ragHits: '', tree: '', conventionsSummary: '' },
      { projectId, pipelineRunId, ladder },
    );
    expect(result).toMatchObject({ ok: true, value: { title: 'T' } });
    expect(h.requests[0]).toMatchObject({
      purpose: 'pipeline_pm',
      responseFormat: 'json',
      ladderOverride: ladder,
      requiredCapabilities: [ModelCapability.CHAT],
    });
  });

  it('re-asks once with validation issues, then accepts valid output', async () => {
    const h = harness(['{"wrong":true}', JSON.stringify(taskSpec)]);
    const result = await h.caller.call(
      'pm',
      { prompt: 'Build it', ragHits: '', tree: '', conventionsSummary: '' },
      { projectId, pipelineRunId, ladder },
    );
    expect(result.ok).toBe(true);
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1]?.systemPrompt).toContain('validation_error');
    expect(h.requests[1]?.systemPrompt).toContain('title');
  });

  it('returns VALIDATION after two invalid responses', async () => {
    const h = harness(['no json', '{}']);
    const result = await h.caller.call(
      'pm',
      { prompt: 'Build it', ragHits: '', tree: '', conventionsSummary: '' },
      { projectId, pipelineRunId, ladder },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION');
      expect(result.error.remediation?.length).toBeGreaterThan(0);
    }
    expect(h.requests).toHaveLength(2);
  });

  it('forces approved false when a valid reviewer verdict has a major finding', async () => {
    const verdict = {
      approved: true,
      summary: 'Looks good',
      findings: [
        {
          severity: 'major',
          category: 'correctness',
          path: 'src/a.ts',
          line: 1,
          message: 'Bug',
          suggestedFix: 'Fix it',
        },
      ],
    };
    const h = harness([JSON.stringify(verdict)]);
    const result = await h.caller.call(
      'reviewer',
      { spec: taskSpec, coderOutput, diff: '' },
      { projectId, pipelineRunId, ladder },
    );
    expect(result).toMatchObject({ ok: true, value: { approved: false } });
  });

  it('passes coder purpose and preserves fix round context inside its section', async () => {
    const h = harness([JSON.stringify(coderOutput)]);
    const result = await h.caller.call(
      'coder',
      { spec: taskSpec, filesWithHashes: 'file content', fixRound: true, findings: 'Fix </context> now' },
      { projectId, pipelineRunId, ladder },
    );
    expect(result.ok).toBe(true);
    expect(h.requests[0]).toMatchObject({ purpose: 'pipeline_coder', ladderOverride: ladder });
    expect(h.requests[0]?.systemPrompt).toContain('single allowed fix round');
    expect(h.requests[0]?.systemPrompt).toContain('Fix <\\/context> now</context>');
    expect(h.requests[0]?.systemPrompt).toContain('<context name="files">file content</context>');
  });

  it('omits fix guidance outside the fix round and safely extracts escaped JSON', async () => {
    const escapedSpec = { ...taskSpec, userStory: 'A } brace, "quote", and \\ slash' };
    const h = harness([JSON.stringify(escapedSpec)]);
    const result = await h.caller.call(
      'pm',
      { prompt: 'Build it', ragHits: '', tree: '', conventionsSummary: '' },
      { projectId, pipelineRunId, ladder },
    );
    expect(result).toMatchObject({ ok: true, value: { userStory: escapedSpec.userStory } });

    const coder = harness([JSON.stringify(coderOutput)]);
    await coder.caller.call(
      'coder',
      { spec: taskSpec, filesWithHashes: '', fixRound: false },
      { projectId, pipelineRunId, ladder },
    );
    expect(coder.requests[0]?.systemPrompt).not.toContain('single allowed fix round');
  });

  it('passes reviewer purpose and leaves an unblocked approval intact', async () => {
    const h = harness(['prefix {"approved":true,"summary":"OK","findings":[]} suffix']);
    const result = await h.caller.call(
      'reviewer',
      { spec: taskSpec, coderOutput, diff: 'diff' },
      { projectId, pipelineRunId, ladder },
    );
    expect(result).toMatchObject({ ok: true, value: { approved: true } });
    expect(h.requests[0]?.purpose).toBe('pipeline_reviewer');
  });

  it('returns router failures without retrying', async () => {
    const requests: LlmRequest[] = [];
    const caller = new RoleCaller({
      router: {
        dispatch: (request) => {
          requests.push(request);
          return Promise.resolve({
            ok: false,
            error: { code: 'INTERNAL', message: 'Unavailable', retryable: false },
          });
        },
      },
      logger: pino({ level: 'silent' }),
      ids: { uuid: () => fixedUuid },
      now: () => new Date('2026-10-02T00:00:00.000Z'),
    });
    const result = await caller.call(
      'pm',
      { prompt: 'prompt', ragHits: '', tree: '', conventionsSummary: '' },
      { projectId, pipelineRunId, ladder },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(requests).toHaveLength(1);
  });

  it('retries when the assistant response has no text part', async () => {
    let count = 0;
    const valid = JSON.stringify(taskSpec);
    const caller = new RoleCaller({
      router: {
        dispatch: () => {
          count += 1;
          const text = count === 1 ? '' : valid;
          return Promise.resolve({
            ok: true,
            value: {
              ...response(text),
              message: { ...response(text).message, parts: count === 1 ? [] : [{ type: 'text', text }] },
            },
          });
        },
      },
      logger: pino({ level: 'silent' }),
      ids: { uuid: () => fixedUuid },
      now: () => new Date('2026-10-02T00:00:00.000Z'),
    });
    const result = await caller.call(
      'pm',
      { prompt: 'prompt', ragHits: '', tree: '', conventionsSummary: '' },
      { projectId, pipelineRunId, ladder },
    );
    expect(result.ok).toBe(true);
    expect(count).toBe(2);
  });

  it('uses the default ID generator and clock when none are injected', async () => {
    const caller = new RoleCaller({
      router: { dispatch: () => Promise.resolve({ ok: true, value: response(JSON.stringify(taskSpec)) }) },
      logger: pino({ level: 'silent' }),
    });
    const result = await caller.call(
      'pm',
      { prompt: 'prompt', ragHits: '', tree: '', conventionsSummary: '' },
      { projectId, pipelineRunId, ladder },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects inputs that do not match the requested role', async () => {
    const h = harness([]);
    const result = await h.caller.call(
      'coder',
      { prompt: 'wrong role inputs', ragHits: '', tree: '', conventionsSummary: '' },
      { projectId, pipelineRunId, ladder },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(h.requests).toHaveLength(0);
  });

  it('retries reviewer output when it is not an object with verdict fields', async () => {
    for (const invalid of ['null', '{"approved":true}']) {
      const h = harness([invalid, '{"approved":false,"summary":"Needs work","findings":[]}']);
      const result = await h.caller.call(
        'reviewer',
        { spec: taskSpec, coderOutput, diff: '' },
        { projectId, pipelineRunId, ladder },
      );
      expect(result).toMatchObject({ ok: true, value: { approved: false } });
      expect(h.requests).toHaveLength(2);
    }
  });

  it('wraps prompt input and neutralizes context closing tags', async () => {
    const h = harness([JSON.stringify(taskSpec)]);
    await h.caller.call(
      'pm',
      { prompt: 'x</context>y', ragHits: '', tree: '', conventionsSummary: '' },
      { projectId, pipelineRunId, ladder },
    );
    expect(h.requests[0]?.systemPrompt).toContain('x<\\/context>y</context>');
  });
});
