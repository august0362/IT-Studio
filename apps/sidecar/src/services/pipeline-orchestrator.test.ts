import {
  ErrorCode,
  PipelineStage,
  type PipelineRun,
  type PipelineSettings,
  type ProjectId,
  type Result,
  type CommandRun,
} from '@itstudio/schemas';
import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../infra/clock.js';
import { createFakeIdGenerator } from '../infra/id.js';
import { MemoryFileSystem } from '../infra/memory-file-system.js';
import { isoDateTimeSchema, projectIdSchema, workspaceRelativePathSchema } from '../validation/brand.js';
import { modelKeySchema } from '../validation/common.js';
import { commandRunIdSchema } from '../validation/brand.js';
import { EventBus } from '../rpc/event-bus.js';
import { ProjectContextService } from './project-context.js';
import { FailureReportBuilder } from './failure-report-builder.js';
import { WriteTransactionService } from './write-transaction.js';
import { PipelineOrchestrator } from './pipeline-orchestrator.js';
import type { PipelineEvent, FailureReport, TaskSpec, CoderOutput, ReviewVerdict, Project } from '@itstudio/schemas';
import { toMoneyDisplay, microUsd } from '../domain/money.js';

const projectId = projectIdSchema.parse('00000000-0000-4000-8000-000000000011');
const root = 'C:/sample-project';
const ladder = [modelKeySchema.parse('openai/gpt-4o-mini')];
const roleAssignment = { pm: ladder, coder: ladder, reviewer: ladder } as const;
const validationCommand = { kind: 'build' as const, executable: 'node', args: ['pass.js'], timeoutMs: 1000 };
const settings: PipelineSettings = { roleAssignment, validationCommands: [validationCommand], maxFixAttempts: 1 };
const spec: TaskSpec = {
  title: 'Write greeting',
  userStory: 'Create greeting file',
  acceptanceCriteria: ['File exists'],
  allowedPaths: [workspaceRelativePathSchema.parse('hello.txt')],
  contracts: '',
  constraints: [],
  testPlan: [],
  outOfScope: [],
};
const created: CoderOutput = {
  summary: 'Create hello file',
  operations: [{ kind: 'create', path: workspaceRelativePathSchema.parse('hello.txt'), content: 'hello' }],
  assumptions: [],
};
const accepted: ReviewVerdict = { approved: true, findings: [], summary: 'Approved' };
const firstAllowedPath = spec.allowedPaths[0] ?? workspaceRelativePathSchema.parse('hello.txt');

interface HarnessOptions {
  readonly commandResult?: () => Promise<Result<CommandRun>>;
  readonly beforeRole?: (role: 'pm' | 'coder' | 'reviewer') => Promise<void>;
  readonly roleFailure?: 'pm' | 'coder' | 'reviewer';
  readonly projectMissing?: boolean;
  readonly hardStop?: () => Promise<boolean>;
  readonly commitFailure?: boolean;
  readonly prepareFailure?: boolean;
  readonly markValidatedFailure?: boolean;
  readonly settingsFailureCall?: number;
}

function harness(
  verdicts: readonly ReviewVerdict[] = [accepted],
  output: CoderOutput = created,
  options: HarnessOptions = {},
) {
  const fs = new MemoryFileSystem();
  const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'));
  const ids = createFakeIdGenerator(
    Array.from({ length: 100 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`),
  );
  const rootDirectory = fs.mkdir(root, true);
  const rows = new Map<string, PipelineRun>();
  const repository = {
    save: (run: PipelineRun) => {
      rows.set(run.id, run);
      return Promise.resolve();
    },
    get: (id: PipelineRun['id']) => Promise.resolve(rows.get(id) ?? null),
    list: (id: ProjectId) => Promise.resolve([...rows.values()].filter((run) => run.projectId === id)),
  };
  let reviewIndex = 0;
  let settingsCalls = 0;
  const roles = {
    call: async (role: 'pm' | 'coder' | 'reviewer'): Promise<Result<TaskSpec | CoderOutput | ReviewVerdict>> => {
      await options.beforeRole?.(role);
      if (role === options.roleFailure)
        return {
          ok: false,
          error: {
            code: ErrorCode.INTERNAL,
            message: 'Injected role failure.',
            retryable: false,
            remediation: ['Retry the pipeline.'],
          },
        };
      if (role === 'pm') return Promise.resolve({ ok: true, value: spec });
      if (role === 'coder') return Promise.resolve({ ok: true, value: output });
      const value = verdicts[reviewIndex] ?? accepted;
      reviewIndex += 1;
      return Promise.resolve({ ok: true, value });
    },
  };
  const project: Project = {
    id: projectId,
    name: 'Sample',
    workspaceRoot: root,
    createdAt: isoDateTimeSchema.parse('2026-01-01T00:00:00.000Z'),
    archived: false,
  };
  const events = new EventBus<{ 'pipeline.event': PipelineEvent; 'pipeline.failureReport': FailureReport }>();
  const fx = { usdToVnd: 25000, asOf: isoDateTimeSchema.parse('2026-01-01T00:00:00.000Z'), source: 'auto' as const };
  const orchestrator = new PipelineOrchestrator({
    repository,
    projects: {
      get: async (id) => {
        const workspaceRoot = id === projectId ? root : `${root}-${id.slice(-2)}`;
        if (workspaceRoot !== root) await fs.mkdir(workspaceRoot, true);
        return options.projectMissing ? null : { ...project, id, workspaceRoot };
      },
    },
    settings: () => {
      settingsCalls += 1;
      return Promise.resolve(
        options.settingsFailureCall === settingsCalls
          ? {
              ok: false as const,
              error: {
                code: ErrorCode.INTERNAL,
                message: 'Injected settings failure.',
                retryable: false,
                remediation: ['Retry the pipeline.'],
              },
            }
          : { ok: true as const, value: settings },
      );
    },
    context: new ProjectContextService(fs),
    roles,
    writer: {
      prepare: async (...args: Parameters<WriteTransactionService['prepare']>) => {
        if (options.prepareFailure)
          return {
            ok: false as const,
            error: {
              code: ErrorCode.INTERNAL,
              message: 'Injected prepare failure.',
              retryable: false,
              remediation: ['Retry the pipeline.'],
            },
          };
        const prepared = await new WriteTransactionService({ fileSystem: fs, ids, clock }).prepare(...args);
        if (prepared.ok) {
          if (options.commitFailure) {
            const commit = prepared.value.commit.bind(prepared.value);
            prepared.value.commit = () => {
              fs.injectFailureAfter(0);
              return commit();
            };
          }
          if (options.markValidatedFailure)
            prepared.value.markValidated = () =>
              Promise.resolve({
                ok: false,
                error: {
                  code: ErrorCode.INTERNAL,
                  message: 'Injected finalize failure.',
                  retryable: false,
                  remediation: ['Retry the pipeline.'],
                },
              });
        }
        return prepared;
      },
    },
    commands: {
      run: (_root: string, command: typeof validationCommand) =>
        options.commandResult?.() ??
        Promise.resolve({
          ok: true,
          value: {
            id: commandRunIdSchema.parse('00000000-0000-4000-8000-000000000090'),
            spec: command,
            exitCode: 0,
            timedOut: false,
            durationMs: 1,
            stdoutTail: '',
            stderrTail: '',
            diagnostics: [],
          },
        }),
    },
    reports: new FailureReportBuilder(),
    fileSystem: fs,
    events,
    ids,
    clock,
    money: () => toMoneyDisplay(microUsd(0), fx),
    ...(options.hardStop === undefined ? {} : { budgetHardStop: options.hardStop }),
  });
  return { fs, rootDirectory, orchestrator, rows, events };
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function expectNoUserWrites(fs: MemoryFileSystem): Promise<void> {
  const exists = await fs.exists(`${root}/hello.txt`);
  expect(exists.ok && exists.value).toBe(false);
}

async function waitForTerminal(orchestrator: PipelineOrchestrator, id: PipelineRun['id']): Promise<PipelineRun> {
  for (let index = 0; index < 100; index += 1) {
    const run = await orchestrator.get(id);
    if (
      run &&
      new Set<PipelineRun['stage']>([
        PipelineStage.COMPLETED,
        PipelineStage.FAILED,
        PipelineStage.ROLLED_BACK,
        PipelineStage.CANCELLED,
      ]).has(run.stage)
    )
      return run;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));
  }
  throw new Error('Pipeline did not finish');
}

describe('PipelineOrchestrator', () => {
  it('returns SPECIFYING immediately and completes the approved write', async () => {
    const h = harness();
    await h.rootDirectory;
    const run = await h.orchestrator.start({ projectId, prompt: 'Create greeting' });
    expect(run.stage).toBe(PipelineStage.SPECIFYING);
    const completed = await waitForTerminal(h.orchestrator, run.id);
    expect(completed.stage, JSON.stringify(completed.failureReport)).toBe(PipelineStage.COMPLETED);
    const file = await h.fs.readFile(`${root}/hello.txt`);
    expect(file.ok && new TextDecoder().decode(file.value)).toBe('hello');
  });

  it('fails after the one permitted rejected fix without writing files', async () => {
    const rejected: ReviewVerdict = {
      approved: false,
      findings: [
        {
          severity: 'major',
          category: 'correctness',
          path: firstAllowedPath,
          message: 'Fix this',
          suggestedFix: 'Correct it',
        },
      ],
      summary: 'Needs fix',
    };
    const h = harness([rejected, rejected]);
    await h.rootDirectory;
    const run = await h.orchestrator.start({ projectId, prompt: 'Create greeting' });
    const failed = await waitForTerminal(h.orchestrator, run.id);
    expect(failed.stage).toBe(PipelineStage.FAILED);
    expect(failed.fixAttempts).toBe(1);
    const exists = await h.fs.exists(`${root}/hello.txt`);
    expect(exists.ok && exists.value).toBe(false);
  });

  it('runs one fix round and writes after the second review approves', async () => {
    const rejected: ReviewVerdict = {
      approved: false,
      findings: [
        {
          severity: 'major',
          category: 'correctness',
          path: firstAllowedPath,
          message: 'Fix this',
          suggestedFix: 'Correct it',
        },
      ],
      summary: 'Needs fix',
    };
    const h = harness([rejected, accepted]);
    await h.rootDirectory;
    const run = await h.orchestrator.start({ projectId, prompt: 'Create greeting' });
    const result = await waitForTerminal(h.orchestrator, run.id);
    expect(result.stage).toBe(PipelineStage.COMPLETED);
    expect(result.fixAttempts).toBe(1);
    expect((await h.fs.readFile(`${root}/hello.txt`)).ok).toBe(true);
  });

  it('rejects coder paths outside the TaskSpec before prepare', async () => {
    const h = harness([accepted], {
      ...created,
      operations: [{ kind: 'create', path: workspaceRelativePathSchema.parse('outside.txt'), content: 'no' }],
    });
    await h.rootDirectory;
    const run = await h.orchestrator.start({ projectId, prompt: 'Create greeting' });
    const result = await waitForTerminal(h.orchestrator, run.id);
    expect(result.stage).toBe(PipelineStage.FAILED);
    expect(result.failureReport?.error.code).toBe(ErrorCode.PATH_OUTSIDE_WORKSPACE);
  });

  it('rolls back validation failure and restores the original user file bytes', async () => {
    const h = harness([accepted], created, {
      commandResult: () =>
        Promise.resolve({
          ok: true,
          value: {
            id: commandRunIdSchema.parse('00000000-0000-4000-8000-000000000090'),
            spec: validationCommand,
            exitCode: 1,
            timedOut: false,
            durationMs: 1,
            stdoutTail: 'failed',
            stderrTail: '',
            diagnostics: [],
          },
        }),
    });
    await h.rootDirectory;
    await h.fs.writeFile(`${root}/keep.txt`, new Uint8Array([0, 1, 255, 10]));
    const before = await h.fs.readFile(`${root}/keep.txt`);
    expect(before.ok).toBe(true);
    const run = await h.orchestrator.start({ projectId, prompt: 'Create greeting' });
    const result = await waitForTerminal(h.orchestrator, run.id);
    const after = await h.fs.readFile(`${root}/keep.txt`);
    expect(result.stage).toBe(PipelineStage.ROLLED_BACK);
    expect(before.ok ? [...before.value] : null).toEqual(after.ok ? [...after.value] : null);
    await expectNoUserWrites(h.fs);
  });

  it.each(['pm', 'coder', 'reviewer'] as const)('cancels during %s before writing', async (pausedRole) => {
    const entered = deferred();
    const release = deferred();
    const h = harness([accepted], created, {
      beforeRole: async (role) => {
        if (role === pausedRole) {
          entered.resolve();
          await release.promise;
        }
      },
    });
    await h.rootDirectory;
    const run = await h.orchestrator.start({ projectId, prompt: 'Create greeting' });
    await entered.promise;
    await h.orchestrator.cancel(run.id);
    release.resolve();
    expect((await waitForTerminal(h.orchestrator, run.id)).stage).toBe(PipelineStage.CANCELLED);
    await expectNoUserWrites(h.fs);
  });

  it('cancels during validation and rolls back the committed write', async () => {
    const entered = deferred();
    const release = deferred();
    const h = harness([accepted], created, {
      commandResult: async () => {
        entered.resolve();
        await release.promise;
        return {
          ok: true,
          value: {
            id: commandRunIdSchema.parse('00000000-0000-4000-8000-000000000090'),
            spec: validationCommand,
            exitCode: 0,
            timedOut: false,
            durationMs: 1,
            stdoutTail: '',
            stderrTail: '',
            diagnostics: [],
          },
        };
      },
    });
    await h.rootDirectory;
    const run = await h.orchestrator.start({ projectId, prompt: 'Create greeting' });
    await entered.promise;
    await h.orchestrator.cancel(run.id);
    release.resolve();
    expect((await waitForTerminal(h.orchestrator, run.id)).stage).toBe(PipelineStage.ROLLED_BACK);
    await expectNoUserWrites(h.fs);
  });

  it('queues same-project runs and lists them in start order', async () => {
    const entered = deferred();
    const release = deferred();
    let pmCalls = 0;
    const rejected: ReviewVerdict = {
      approved: false,
      findings: [
        {
          severity: 'major',
          category: 'correctness',
          path: firstAllowedPath,
          message: 'Needs a change',
          suggestedFix: 'Change it',
        },
      ],
      summary: 'Rejected',
    };
    const h = harness([rejected, rejected], created, {
      beforeRole: async (role) => {
        if (role !== 'pm') return;
        pmCalls += 1;
        if (pmCalls === 1) {
          entered.resolve();
          await release.promise;
        }
      },
    });
    await h.rootDirectory;
    const first = await h.orchestrator.start({ projectId, prompt: 'first' });
    await entered.promise;
    const second = await h.orchestrator.start({ projectId, prompt: 'second' });
    expect(pmCalls).toBe(1);
    expect((await h.orchestrator.list({ projectId, limit: 10 })).map((run) => run.id)).toEqual([first.id, second.id]);
    release.resolve();
    expect((await waitForTerminal(h.orchestrator, first.id)).stage).toBe(PipelineStage.FAILED);
    expect((await waitForTerminal(h.orchestrator, second.id)).stage).toBe(PipelineStage.COMPLETED);
    expect(pmCalls).toBe(2);
  });

  it('runs different projects in parallel', async () => {
    const firstEntered = deferred();
    const secondEntered = deferred();
    const release = deferred();
    const secondProjectId = projectIdSchema.parse('00000000-0000-4000-8000-000000000012');
    let pmCalls = 0;
    const h = harness([accepted], created, {
      beforeRole: async (role) => {
        if (role !== 'pm') return;
        pmCalls += 1;
        if (pmCalls === 1) {
          firstEntered.resolve();
          await release.promise;
        } else secondEntered.resolve();
      },
    });
    await h.rootDirectory;
    const first = await h.orchestrator.start({ projectId, prompt: 'first' });
    await firstEntered.promise;
    const second = await h.orchestrator.start({ projectId: secondProjectId, prompt: 'second' });
    await secondEntered.promise;
    release.resolve();
    expect((await waitForTerminal(h.orchestrator, first.id)).stage).toBe(PipelineStage.COMPLETED);
    expect((await waitForTerminal(h.orchestrator, second.id)).stage).toBe(PipelineStage.COMPLETED);
    expect(pmCalls).toBe(2);
  });

  it('stops at the pre-write budget boundary without writing', async () => {
    const h = harness([accepted], created, { hardStop: () => Promise.resolve(true) });
    await h.rootDirectory;
    const run = await h.orchestrator.start({ projectId, prompt: 'Create greeting' });
    const result = await waitForTerminal(h.orchestrator, run.id);
    expect(result.stage).toBe(PipelineStage.FAILED);
    expect(result.failureReport?.error.code).toBe(ErrorCode.BUDGET_HARD_STOP);
    await expectNoUserWrites(h.fs);
  });

  it('rolls back when the budget hard stop is reached during validation', async () => {
    let checks = 0;
    const h = harness([accepted], created, {
      hardStop: () => Promise.resolve(++checks >= 5),
    });
    await h.rootDirectory;
    const run = await h.orchestrator.start({ projectId, prompt: 'Create greeting' });
    const result = await waitForTerminal(h.orchestrator, run.id);
    expect(result.stage).toBe(PipelineStage.ROLLED_BACK);
    expect(result.failureReport?.error.code).toBe(ErrorCode.BUDGET_HARD_STOP);
    await expectNoUserWrites(h.fs);
  });

  it('rolls back a commit failure and publishes one failure report', async () => {
    const h = harness([accepted], created, { commitFailure: true });
    let reports = 0;
    h.events.subscribe('pipeline.failureReport', () => {
      reports += 1;
    });
    await h.rootDirectory;
    const run = await h.orchestrator.start({ projectId, prompt: 'Create greeting' });
    const result = await waitForTerminal(h.orchestrator, run.id);
    expect(result.stage).toBe(PipelineStage.ROLLED_BACK);
    expect(result.failureReport).toBeDefined();
    await expectNoUserWrites(h.fs);
    expect(reports).toBe(1);
  });

  it.each(['pm', 'coder', 'reviewer'] as const)('reports a %s role failure before writing', async (role) => {
    const h = harness([accepted], created, { roleFailure: role });
    await h.rootDirectory;
    const run = await h.orchestrator.start({ projectId, prompt: 'Create greeting' });
    expect((await waitForTerminal(h.orchestrator, run.id)).stage).toBe(PipelineStage.FAILED);
    await expectNoUserWrites(h.fs);
  });

  it('reports an invalid project or settings result from start', async () => {
    const missingProject = harness([accepted], created, { projectMissing: true });
    await expect(missingProject.orchestrator.start({ projectId, prompt: 'Missing' })).rejects.toThrow(
      'project does not exist',
    );
    const failingSettings = harness([accepted], created, { settingsFailureCall: 1 });
    await expect(failingSettings.orchestrator.start({ projectId, prompt: 'No settings' })).rejects.toThrow(
      'Injected settings failure',
    );
  });

  it('rolls back when validation settings cannot be reloaded', async () => {
    const h = harness([accepted], created, { settingsFailureCall: 2 });
    await h.rootDirectory;
    const run = await h.orchestrator.start({ projectId, prompt: 'Create greeting' });
    expect((await waitForTerminal(h.orchestrator, run.id)).stage).toBe(PipelineStage.ROLLED_BACK);
    await expectNoUserWrites(h.fs);
  });

  it('rolls back when a validation command returns an error', async () => {
    const h = harness([accepted], created, {
      commandResult: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: ErrorCode.COMMAND_FAILED,
            message: 'Runner failed.',
            retryable: false,
            remediation: ['Check the command.'],
          },
        }),
    });
    await h.rootDirectory;
    const run = await h.orchestrator.start({ projectId, prompt: 'Create greeting' });
    expect((await waitForTerminal(h.orchestrator, run.id)).stage).toBe(PipelineStage.ROLLED_BACK);
    await expectNoUserWrites(h.fs);
  });

  it('reports prepare errors without treating them as committed writes', async () => {
    const h = harness([accepted], created, { prepareFailure: true });
    await h.rootDirectory;
    const run = await h.orchestrator.start({ projectId, prompt: 'Create greeting' });
    const result = await waitForTerminal(h.orchestrator, run.id);
    expect(result.stage).toBe(PipelineStage.ROLLED_BACK);
    expect(result.failureReport?.rolledBack).toBe(false);
    await expectNoUserWrites(h.fs);
  });

  it('rolls back when the transaction cannot be marked validated', async () => {
    const h = harness([accepted], created, { markValidatedFailure: true });
    await h.rootDirectory;
    const run = await h.orchestrator.start({ projectId, prompt: 'Create greeting' });
    expect((await waitForTerminal(h.orchestrator, run.id)).stage).toBe(PipelineStage.ROLLED_BACK);
    await expectNoUserWrites(h.fs);
  });
});
