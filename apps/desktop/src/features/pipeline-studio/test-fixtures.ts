import type { ClarificationQuestion, PipelineRun } from '@itstudio/schemas';

export function pipeline(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    // @ts-expect-error Readable fixture stands in for a branded run identifier.
    id: 'run-1',
    // @ts-expect-error Readable fixture stands in for a branded project identifier.
    projectId: 'project-1',
    prompt: 'Build a sample',
    stage: 'specifying',
    roleAssignment: { pm: [], coder: [], reviewer: [] },
    coderOutputs: [],
    verdicts: [],
    fixAttempts: 0,
    cost: {
      // @ts-expect-error Integer fixture stands in for branded money.
      microUsd: 0,
      // @ts-expect-error Integer fixture stands in for branded money.
      vnd: 0,
      usdText: '$0.00',
      vndText: '0 ₫',
      // @ts-expect-error ISO fixture stands in for a branded timestamp.
      fxAsOf: '2026-01-01T00:00:00.000Z',
    },
    // @ts-expect-error ISO fixture stands in for a branded timestamp.
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
export const QUESTION: ClarificationQuestion = {
  id: 'storage',
  question: 'Where should data live?',
  why: 'Changes the API.',
  options: [
    { id: 'local', label: 'Local' },
    { id: 'cloud', label: 'Cloud' },
  ],
  recommendedOptionId: 'local',
  recommendationReason: 'Works offline.',
};
export const VALIDATED = pipeline({
  stage: 'completed',
  validation: [
    {
      // @ts-expect-error Readable fixture stands in for a branded command identifier.
      id: 'command-1',
      spec: { kind: 'test', executable: 'node', args: ['test.js'], timeoutMs: 1000 },
      exitCode: 0,
      durationMs: 100,
      timedOut: false,
      stdoutTail: '3 tests passed',
      stderrTail: '',
      diagnostics: [],
    },
  ],
  finishedAt: pipeline().startedAt,
});
