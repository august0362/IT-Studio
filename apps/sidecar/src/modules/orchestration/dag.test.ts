import { describe, expect, it } from 'vitest';
import { validatePlan } from './dag.js';
const options = { workspaceRoot: 'C:/workspace', allowedCommands: [{ executable: 'npm', args: ['test'] }] };
const task = (id: string, dependsOn: string[] = []) => ({
  id,
  title: id,
  objective: 'do work',
  dependsOn,
  role: 'worker',
  candidateAgents: ['worker'],
  allowedPaths: ['src/**'],
  testCommands: [],
  acceptanceCriteria: ['works'],
  estimate: 'S',
  timeoutMs: 1000,
});
describe('orchestration plan validation', () => {
  it('ORCH-001 accepts a valid plan and rejects cycles, unknown dependencies, unsafe paths and duplicate ids', () => {
    expect(validatePlan({ tasks: [task('T1')] }, options).ok).toBe(true);
    expect(validatePlan({ tasks: [task('T1', ['T2']), task('T2', ['T1'])] }, options).ok).toBe(false);
    expect(validatePlan({ tasks: [task('T1', ['T2'])] }, options).ok).toBe(false);
    expect(validatePlan({ tasks: [{ ...task('T1'), allowedPaths: ['../secret'] }] }, options).ok).toBe(false);
    expect(validatePlan({ tasks: [{ ...task('T1'), allowedPaths: ['/absolute'] }] }, options).ok).toBe(false);
    expect(validatePlan({ tasks: [{ ...task('T1'), acceptanceCriteria: [] }] }, options).ok).toBe(false);
    expect(validatePlan({ tasks: [task('T1'), task('T1')] }, options).ok).toBe(false);
  });
  it('rejects commands outside the project validation allow-list', () => {
    expect(
      validatePlan(
        {
          tasks: [
            { ...task('T1'), testCommands: [{ kind: 'test', executable: 'cmd', args: ['/c', 'bad'], timeoutMs: 1 }] },
          ],
        },
        options,
      ).ok,
    ).toBe(false);
  });
});
