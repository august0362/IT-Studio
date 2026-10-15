import { afterEach, describe, expect, it, vi } from 'vitest';
import { badge, defaultPosition, LAYOUT_KEY, moduleStatuses, readLayout, runPath, writeLayout } from './studio-model';
import { pipeline, QUESTION } from './test-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
describe('PSTUDIO-02 status mapping', () => {
  it('spec-direct: Request is done, Spec active, Clarify and fix branch skipped', () => {
    expect(moduleStatuses(pipeline(), ['specifying'], false)).toMatchObject({
      request: 'done',
      clarify: 'skipped',
      spec: 'active',
      code: 'idle',
      fix: 'skipped',
      're-review': 'skipped',
      done: 'idle',
    });
  });
  it('clarifying-waiting: ? belongs only to Clarify and Spec has not passed', () => {
    const states = moduleStatuses(
      pipeline({ stage: 'clarifying', clarifications: [QUESTION] }),
      ['specifying', 'clarifying'],
      false,
    );
    expect(states).toMatchObject({ request: 'done', clarify: 'waiting', spec: 'idle' });
    expect(badge('clarify', states.clarify)).toBe('?');
  });
  it('auto-answered: Clarify remains done after entering Spec or Code', () => {
    const run = pipeline({
      stage: 'coding',
      clarifications: [{ ...QUESTION, answer: { by: 'auto', optionId: 'local', at: pipeline().startedAt } }],
    });
    expect(moduleStatuses(run, ['clarifying', 'specifying', 'coding'], false)).toMatchObject({
      clarify: 'done',
      spec: 'done',
      code: 'active',
    });
  });
  it('fix branch entered vs skipped, including an event before fixAttempts is saved', () => {
    expect(moduleStatuses(pipeline({ stage: 'fixing' }), ['fixing'], false)).toMatchObject({
      review: 'done',
      fix: 'active',
      're-review': 'idle',
    });
    expect(moduleStatuses(pipeline({ stage: 'writing', fixAttempts: 1 }), [], false)).toMatchObject({
      fix: 'done',
      're-review': 'done',
      write: 'active',
    });
    expect(moduleStatuses(pipeline({ stage: 'writing' }), [], false)).toMatchObject({
      fix: 'skipped',
      're-review': 'skipped',
    });
  });
  it.each(['failed', 'rolled_back'] as const)(
    'QA round 2: %s marks only the failing Code module with ✕ and leaves Done idle',
    (stage) => {
      const states = moduleStatuses(
        pipeline({
          stage,
          failureReport: {
            stage: 'coding',
            rolledBack: stage === 'rolled_back',
            error: { code: 'INTERNAL', message: 'Failure', retryable: false },
            nextSteps: ['Retry'],
            logExcerpt: 'failed',
          },
        }),
        ['specifying', 'coding'],
        true,
      );
      expect(states).toMatchObject({ spec: 'done', code: 'failed', review: 'idle', done: 'idle' });
      expect(badge('code', states.code)).toBe('✕');
      expect(badge('done', states.done)).toBe('—');
      expect(Object.values(states).filter((status) => status === 'failed')).toHaveLength(1);
    },
  );
  it('cancelled uses the last observed stage and never marks Done ✓', () => {
    const states = moduleStatuses(pipeline({ stage: 'cancelled' }), ['specifying', 'coding'], true);
    expect(states).toMatchObject({ code: 'cancelled', done: 'cancelled', review: 'idle' });
    expect(badge('done', states.done)).toBe('—');
  });
  it('completed marks Done ✓ and skips unentered optional stages', () => {
    const states = moduleStatuses(pipeline({ stage: 'completed' }), [], true);
    expect(states).toMatchObject({
      validate: 'done',
      done: 'done',
      clarify: 'skipped',
      fix: 'skipped',
      're-review': 'skipped',
    });
    expect(badge('done', states.done)).toBe('✓');
    expect(runPath(pipeline({ stage: 'completed' }))).toEqual([
      'request',
      'spec',
      'code',
      'review',
      'write',
      'validate',
      'done',
    ]);
  });
  it('queued has an amber waiting Request without ? and no active Spec', () => {
    const states = moduleStatuses(pipeline(), [], false, true);
    expect(states).toMatchObject({ request: 'waiting', spec: 'idle', clarify: 'idle' });
    expect(badge('request', states.request)).not.toBe('?');
  });
  it('no runs leaves Request idle', () => {
    expect(moduleStatuses(undefined, [], false).request).toBe('idle');
  });
});
describe('PSTUDIO-02 optional layout storage', () => {
  it('persists positions, ignores malformed entries and restores defaults', () => {
    writeLayout({ code: { x: 12, y: 34 } });
    expect(readLayout()).toEqual({ code: { x: 12, y: 34 } });
    localStorage.setItem(LAYOUT_KEY, '{"code":{"x":"bad","y":0},"request":{"x":1,"y":2}}');
    expect(readLayout()).toEqual({ request: { x: 1, y: 2 } });
    writeLayout({});
    expect(readLayout()).toEqual({});
    expect(defaultPosition('code')).toEqual({ x: 750, y: 0 });
  });
  it('tolerates corrupt JSON and throwing storage reads and writes', () => {
    localStorage.setItem(LAYOUT_KEY, 'not json');
    expect(readLayout()).toEqual({});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    expect(readLayout()).toEqual({});
    expect(() => {
      writeLayout({});
    }).not.toThrow();
  });
});
