import { describe, expect, it } from 'vitest';
import type { OrchAttempt, OrchTask } from '@itstudio/schemas';
import { interruptedAttempts, interruptedTasks, requeueUnfinished, taskResume } from './recovery.js';

const usage = {
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  reasoningTokens: null,
  source: 'unknown' as const,
  costMicroUsd: null,
  billing: 'unknown' as const,
};

function attempt(
  id: string,
  role: OrchAttempt['role'],
  state: OrchAttempt['state'],
  extra: Partial<OrchAttempt> = {},
): OrchAttempt {
  return {
    id: id as OrchAttempt['id'],
    taskId: 'T1' as OrchAttempt['taskId'],
    role,
    agent: { agentId: role, role, transport: 'mock' },
    state,
    changedFiles: [],
    evidence: [],
    usage,
    startedAt: '2026-10-20T00:00:00.000Z' as OrchAttempt['startedAt'],
    ...extra,
  };
}

const worktree = 'C:/repo/.itstudio/orch/run-1/T1-2';
const verdict = (value: 'pass' | 'fix_required'): NonNullable<OrchAttempt['verdict']> => ({
  verdict: value,
  summary: value,
  findings: value === 'pass' ? [] : [{ severity: 'major', path: 'src/a.ts', message: 'Bug', suggestedFix: 'Fix it' }],
});

function task(state: OrchTask['state'], stateReason?: string): OrchTask {
  return {
    id: 'T1' as OrchTask['id'],
    title: 'T',
    objective: 'o',
    dependsOn: [],
    role: 'worker',
    candidateAgents: ['w'],
    allowedPaths: ['src/**'],
    testCommands: [],
    acceptanceCriteria: ['a'],
    estimate: 'S',
    timeoutMs: 1,
    state,
    ...(stateReason === undefined ? {} : { stateReason }),
    fixRounds: 0,
    attempts: [],
  };
}

describe('orchestration recovery (STAB P1-01)', () => {
  it('P1-01 restart sweep queues in-flight tasks and marks running attempts unknown, nothing else', () => {
    const states: OrchTask['state'][] = ['running', 'in_review', 'assigned', 'completed', 'failed', 'fix_required'];
    expect(interruptedTasks(states.map((state) => task(state))).map((item) => [item.state, item.stateReason])).toEqual([
      ['queued', 'INTERRUPTED'],
      ['queued', 'INTERRUPTED'],
      ['queued', 'INTERRUPTED'],
      ['completed', undefined],
      ['failed', undefined],
      ['fix_required', undefined],
    ]);
    expect(
      interruptedAttempts([attempt('a', 'worker', 'running'), attempt('b', 'worker', 'succeeded')]).map((item) => [
        item.state,
        item.reason,
      ]),
    ).toEqual([
      ['unknown', 'INTERRUPTED'],
      ['succeeded', undefined],
    ]);
  });

  it('P1-01 a resumed run keeps completed tasks and queues every other one without its old reason', () => {
    const tasks = requeueUnfinished([task('completed'), task('failed', 'WORKER_FAILED'), task('blocked', 'X')]);
    expect(tasks.map((item) => [item.state, item.stateReason])).toEqual([
      ['completed', undefined],
      ['queued', undefined],
      ['queued', undefined],
    ]);
  });

  it('P1-01 an unreviewed successful worker attempt is reviewed again, not redone', () => {
    const resume = taskResume('run-1', 'T1', [
      attempt('w1', 'worker', 'succeeded', { worktree: 'C:/repo/.itstudio/orch/run-1/T1-1', baseSha: 'base' }),
      attempt('r1', 'reviewer', 'succeeded', { verdict: verdict('fix_required') }),
      attempt('w2', 'worker', 'succeeded', { worktree, baseSha: 'base' }),
      attempt('r2', 'reviewer', 'unknown'),
    ]);
    expect(resume).toEqual({
      worktree: { path: worktree, branch: 'itstudio/orch/run-1/T1-2', baseSha: 'base' },
      reviewPending: true,
      reviewPassed: false,
      findings: verdict('fix_required').findings,
      workerAttempts: 2,
    });
  });

  it('P1-01 a fix request after the last worker attempt sends the findings to a new attempt', () => {
    const resume = taskResume('run-1', 'T1', [
      attempt('w1', 'worker', 'succeeded', { worktree }),
      attempt('r1', 'reviewer', 'succeeded', { verdict: verdict('fix_required') }),
    ]);
    expect(resume.reviewPending).toBe(false);
    expect(resume.reviewPassed).toBe(false);
    expect(resume.findings).toHaveLength(1);
  });

  it('P1-01 a pass that was saved before the task state counts as completed', () => {
    const resume = taskResume('run-1', 'T1', [
      attempt('w1', 'worker', 'succeeded', { worktree }),
      attempt('r1', 'reviewer', 'succeeded', { verdict: verdict('pass') }),
    ]);
    expect(resume.reviewPassed).toBe(true);
  });

  it('P1-01 unknown and failed worker attempts still count for numbering but give no worktree', () => {
    const resume = taskResume('run-1', 'T1', [
      attempt('w1', 'worker', 'unknown', { worktree }),
      attempt('w2', 'worker', 'failed'),
      attempt('other', 'worker', 'succeeded', { taskId: 'T2' as OrchAttempt['taskId'], worktree }),
    ]);
    expect(resume).toEqual({ reviewPending: false, reviewPassed: false, findings: [], workerAttempts: 2 });
  });
});
