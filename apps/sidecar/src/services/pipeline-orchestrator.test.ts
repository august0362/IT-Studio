import {
  ErrorCode,
  PipelineStage,
  type PipelineRun,
  type PipelineSettings,
  type ProjectId,
  type Result,
  type CommandRun,
  type RoleAssignment,
  ModelCapability,
  ProviderId,
} from '@itstudio/schemas';
import { describe, expect, it, vi } from 'vitest';
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
import { PipelineOrchestrator, type PipelineOrchestratorDependencies } from './pipeline-orchestrator.js';
import type { IPipelineEligibility } from './pipeline-orchestrator.js';
import type { RoleOutput, RoleInputs, RoleCallOptions } from './role-caller.js';
import type { PipelineEvent, FailureReport, TaskSpec, CoderOutput, ReviewVerdict, Project } from '@itstudio/schemas';
import { toMoneyDisplay, microUsd } from '../domain/money.js';
import { PassThrough } from 'node:stream';
import { RpcServer } from '../rpc/rpc-server.js';
import { LineTransport } from '../rpc/line-transport.js';
import { createLogger } from '../infra/logger.js';
import type { RpcNotificationMap } from '@itstudio/schemas';

const projectId = projectIdSchema.parse('00000000-0000-4000-8000-000000000011');
const root = 'C:/sample-project';
const ladder = [modelKeySchema.parse('openai/gpt-4o-mini')];
const roleAssignment = { pm: ladder, coder: ladder, reviewer: ladder } as const;
const validationCommand = { kind: 'build' as const, executable: 'node', args: ['pass.js'], timeoutMs: 1000 };
const settings: PipelineSettings = {
  roleAssignment,
  validationCommands: [validationCommand],
  maxFixAttempts: 1,
  autoClarify: false,
};
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
const questions = [
  {
    id: 'storage',
    question: 'Where should data live?',
    why: 'This determines the storage API.',
    options: [
      { id: 'local', label: 'Local' },
      { id: 'cloud', label: 'Cloud' },
    ],
    recommendedOptionId: 'local',
    recommendationReason: 'The app works offline.',
  },
] as const;
const askOnce = (inputs: RoleInputs): Extract<RoleOutput, { readonly kind: string }> =>
  'clarifications' in inputs ? { kind: 'spec', spec } : { kind: 'questions', questions };

interface HarnessOptions {
  readonly eligibility?: IPipelineEligibility;
  readonly assignment?: RoleAssignment;
  readonly commandResult?: () => Promise<Result<CommandRun>>;
  readonly beforeRole?: (role: 'pm' | 'coder' | 'reviewer') => Promise<void>;
  readonly beforeCommit?: () => Promise<void>;
  readonly roleFailure?: 'pm' | 'coder' | 'reviewer';
  readonly projectMissing?: boolean;
  readonly hardStop?: () => Promise<boolean>;
  readonly commitFailure?: boolean;
  readonly prepareFailure?: boolean;
  readonly markValidatedFailure?: boolean;
  readonly settingsFailureCall?: number;
  readonly autoClarify?: boolean;
  readonly pmOutput?: (inputs: RoleInputs) => Extract<RoleOutput, { readonly kind: string }>;
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
  let costReads = 0;
  const calls: { readonly role: string; readonly inputs: RoleInputs; readonly options: RoleCallOptions }[] = [];
  const roles = {
    call: async (
      role: 'pm' | 'coder' | 'reviewer',
      inputs: RoleInputs,
      callOptions: RoleCallOptions,
    ): Promise<Result<RoleOutput>> => {
      calls.push({ role, inputs, options: callOptions });
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
      if (role === 'pm') return { ok: true, value: options.pmOutput?.(inputs) ?? { kind: 'spec', spec } };
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
  const dependencies: PipelineOrchestratorDependencies = {
    eligibility: options.eligibility ?? {
      load: () =>
        Promise.resolve({
          ok: true,
          value: {
            models: [],
            configuredProviders: [ProviderId.OPENAI],
            eligibleModelKeys: ladder,
          },
        }),
    },
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
          : {
              ok: true as const,
              value: {
                ...settings,
                roleAssignment: options.assignment ?? roleAssignment,
                autoClarify: options.autoClarify ?? false,
              },
            },
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
          if (options.beforeCommit !== undefined) {
            const commit = prepared.value.commit.bind(prepared.value);
            prepared.value.commit = async () => {
              await options.beforeCommit?.();
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
    runCost: () => {
      costReads += 1;
      return Promise.resolve(microUsd(costReads * 10));
    },
    moneyDisplay: (amount) => toMoneyDisplay(amount, fx),
    ...(options.hardStop === undefined ? {} : { budgetHardStop: options.hardStop }),
  };
  const orchestrator = new PipelineOrchestrator(dependencies);
  return {
    fs,
    rootDirectory,
    orchestrator,
    rows,
    events,
    calls,
    restart: () => new PipelineOrchestrator(dependencies),
    get costReads() {
      return costReads;
    },
  };
}

async function startRun(
  orchestrator: PipelineOrchestrator,
  input: Parameters<PipelineOrchestrator['start']>[0],
): Promise<PipelineRun> {
  const result = await orchestrator.start(input);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
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
  const pm = modelKeySchema.parse('anthropic/pm');
  const coder = modelKeySchema.parse('openai/coder');
  const reviewer = modelKeySchema.parse('anthropic/reviewer');
  const google = modelKeySchema.parse('google/available');
  const assignment = { pm: [pm, google], coder: [coder, google], reviewer: [reviewer, google] };
  const models = [pm, coder, reviewer, google].map((key) => ({
    key,
    provider: key === google ? ProviderId.GOOGLE : key === coder ? ProviderId.OPENAI : ProviderId.ANTHROPIC,
    providerModelId: key.slice(key.indexOf('/') + 1),
    displayName: key === google ? 'Gemini' : key,
    capabilities: [ModelCapability.CHAT, ModelCapability.JSON_MODE],
    enabled: true,
    contextWindowTokens: 1000,
    maxOutputTokens: 100,
  }));
  it.each(['pm', 'coder', 'reviewer', 'all'] as const)(
    'TC-UX2-preflight rejects %s before creating a run or calling a role',
    async (role) => {
      const unavailable = role === 'all' ? (['pm', 'coder', 'reviewer'] as const) : [role];
      const h = harness([accepted], created, {
        assignment: { pm: [pm], coder: [coder], reviewer: [reviewer] },
        eligibility: {
          load: () =>
            Promise.resolve({
              ok: true,
              value: {
                models,
                configuredProviders: [ProviderId.GOOGLE],
                eligibleModelKeys: [
                  google,
                  ...(['pm', 'coder', 'reviewer'] as const)
                    .filter((item) => !unavailable.includes(item))
                    .flatMap((item) => assignment[item].slice(0, 1)),
                ],
              },
            }),
        },
      });
      const result = await h.orchestrator.start({ projectId, prompt: 'Build' });
      expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.VALIDATION } });
      if (result.ok) throw new Error('Expected preflight rejection');
      for (const name of unavailable) expect(result.error.message).toContain(name);
      expect(result.error.remediation?.join(' ')).toContain('Google: Gemini');
      expect(result.error.remediation?.join(' ')).toContain('Settings \u2192 API Keys');
      expect(h.rows.size).toBe(0);
      expect(h.calls).toHaveLength(0);
    },
  );
  it('TC-UX2-preflight accepts one usable model per role while other candidates are unusable', async () => {
    const h = harness([accepted], created, {
      assignment,
      eligibility: {
        load: () =>
          Promise.resolve({
            ok: true,
            value: {
              models,
              configuredProviders: [ProviderId.GOOGLE],
              eligibleModelKeys: [google],
            },
          }),
      },
    });
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Build' });
    expect((await waitForTerminal(h.orchestrator, run.id)).stage).toBe(PipelineStage.COMPLETED);
    expect(h.calls).toHaveLength(3);
  });
  it('TC-UX2-preflight rejects empty ladders and propagates eligibility errors without side effects', async () => {
    const empty = harness([accepted], created, { assignment: { pm: [], coder: [], reviewer: [] } });
    const result = await empty.orchestrator.start({ projectId, prompt: 'Build' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected preflight rejection');
    expect(result.error.message).toContain('pm, coder, reviewer');
    expect(result.error.remediation?.[0]).toContain('chat and JSON');
    const failure = {
      code: ErrorCode.INTERNAL,
      message: 'Secret store unavailable',
      retryable: false,
      remediation: ['Unlock the credential store.'],
    };
    const h = harness([accepted], created, {
      eligibility: { load: () => Promise.resolve({ ok: false, error: failure }) },
    });
    expect(await h.orchestrator.start({ projectId, prompt: 'Build' })).toEqual({ ok: false, error: failure });
    expect(h.rows.size).toBe(0);
    expect(h.calls).toHaveLength(0);
  });

  it.each([false, true])(
    'PSTUDIO-01 honours cancellation at the clarification stage (auto=%s)',
    async (autoClarify) => {
      const h = harness([accepted], created, { pmOutput: askOnce, autoClarify });
      h.events.subscribe('pipeline.event', (event) => {
        if (event.type === 'stage' && event.stage === PipelineStage.CLARIFYING) void h.orchestrator.cancel(event.runId);
      });
      const run = await startRun(h.orchestrator, { projectId, prompt: 'First' });
      expect((await waitForTerminal(h.orchestrator, run.id)).stage).toBe(PipelineStage.CANCELLED);
      expect(h.calls.filter((call) => call.role === 'coder')).toHaveLength(0);
    },
  );

  it('PSTUDIO-01 honours cancellation racing an invalid answer submission', async () => {
    const h = harness([accepted], created, { pmOutput: askOnce });
    const run = await startRun(h.orchestrator, { projectId, prompt: 'First' });
    await vi.waitFor(() => {
      expect(h.rows.get(run.id)?.stage).toBe(PipelineStage.CLARIFYING);
    });
    await Promise.all([
      h.orchestrator.answerClarifications({ runId: run.id, answers: [] }),
      h.orchestrator.cancel(run.id),
    ]);
    expect((await h.orchestrator.get(run.id))?.stage).toBe(PipelineStage.CANCELLED);
  });
  it.each([
    { name: 'missing run', stage: 'missing', answers: [{ questionId: 'storage', optionId: 'local' }] },
    { name: 'wrong stage', stage: 'completed', answers: [{ questionId: 'storage', optionId: 'local' }] },
    { name: 'missing answer', answers: [] },
    { name: 'unknown question', answers: [{ questionId: 'unknown', optionId: 'local' }] },
    {
      name: 'duplicate answer',
      answers: [
        { questionId: 'storage', optionId: 'local' },
        { questionId: 'storage', optionId: 'local' },
      ],
    },
    { name: 'bad option', answers: [{ questionId: 'storage', optionId: 'bad' }] },
    { name: 'bad option with text', answers: [{ questionId: 'storage', optionId: 'bad', freeText: 'SQLite' }] },
    { name: 'empty answer', answers: [{ questionId: 'storage' }] },
    { name: 'empty text', answers: [{ questionId: 'storage', freeText: '' }] },
    { name: 'blank text', answers: [{ questionId: 'storage', freeText: '  ' }] },
    { name: 'long text', answers: [{ questionId: 'storage', freeText: 'x'.repeat(2001) }] },
  ])('PSTUDIO-01 RPC rejects $name without resuming', async ({ stage, answers }) => {
    const h = harness([accepted], created, { pmOutput: askOnce });
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Build storage' });
    await vi.waitFor(() => {
      expect(h.rows.get(run.id)?.stage).toBe(PipelineStage.CLARIFYING);
    });
    if (stage === 'completed') {
      const waiting = h.rows.get(run.id);
      if (waiting === undefined) throw new Error('Missing waiting row');
      h.rows.set(run.id, { ...waiting, stage: PipelineStage.COMPLETED });
    }
    const orchestrator = h.restart();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
    const transport = new LineTransport({ input: new PassThrough(), output, onLine: () => undefined });
    const server = new RpcServer(transport, new EventBus<RpcNotificationMap>(), createLogger({ streams: [] }));
    server.register('pipeline.answerClarifications', (input) => orchestrator.answerClarifications(input));
    const runId = stage === 'missing' ? '00000000-0000-4000-8000-000000000099' : run.id;
    await server.handleLine(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'pipeline.answerClarifications', params: { runId, answers } }),
    );
    const response: unknown = JSON.parse(chunks.join(''));
    expect(response).toMatchObject({ error: { data: { code: ErrorCode.VALIDATION } } });
    expect(h.calls).toHaveLength(1);
  });

  it.each([1, 2000])('PSTUDIO-01 accepts free-text boundary of %s characters after restart', async (length) => {
    const h = harness([accepted], created, { pmOutput: askOnce });
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Build storage' });
    await vi.waitFor(() => {
      expect(h.rows.get(run.id)?.stage).toBe(PipelineStage.CLARIFYING);
    });
    const restarted = h.restart();
    const result = await restarted.answerClarifications({
      runId: run.id,
      answers: [{ questionId: 'storage', freeText: 'x'.repeat(length) }],
    });
    expect(result.ok).toBe(true);
    expect((await waitForTerminal(restarted, run.id)).stage).toBe(PipelineStage.COMPLETED);
  });
  it('PSTUDIO-01 waits for manual answers, preserves Q&A, and resumes through coding', async () => {
    const h = harness([accepted], created, { pmOutput: askOnce });
    const events: PipelineEvent[] = [];
    h.events.subscribe('pipeline.event', (event) => events.push(event));
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Build storage' });
    await vi.waitFor(() => {
      expect(h.rows.get(run.id)?.stage).toBe(PipelineStage.CLARIFYING);
    });
    expect(h.calls.map((call) => call.role)).toEqual(['pm']);
    expect(h.rows.get(run.id)?.clarifications).toEqual(questions);
    await expectNoUserWrites(h.fs);
    const result = await h.orchestrator.answerClarifications({
      runId: run.id,
      answers: [{ questionId: 'storage', freeText: 'Use SQLite' }],
    });
    expect(result).toMatchObject({ ok: true, value: { stage: PipelineStage.SPECIFYING } });
    const completed = await waitForTerminal(h.orchestrator, run.id);
    expect(completed.stage).toBe(PipelineStage.COMPLETED);
    expect(completed.clarifications?.[0]?.answer).toEqual({ freeText: 'Use SQLite', by: 'user', at: run.startedAt });
    expect(h.calls.map((call) => call.role)).toEqual(['pm', 'pm', 'coder', 'reviewer']);
    expect(h.calls[1]?.inputs).toMatchObject({ clarifications: completed.clarifications });
    expect(events.filter((event) => event.type === 'clarification')).toEqual([
      { type: 'clarification', runId: run.id, status: 'required' },
      { type: 'clarification', runId: run.id, status: 'answered' },
    ]);
  });

  it('PSTUDIO-01 auto answers recommendations and emits both clarification stages and events', async () => {
    const h = harness([accepted], created, { pmOutput: askOnce, autoClarify: true });
    const events: PipelineEvent[] = [];
    h.events.subscribe('pipeline.event', (event) => events.push(event));
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Build storage' });
    const completed = await waitForTerminal(h.orchestrator, run.id);
    expect(completed.stage).toBe(PipelineStage.COMPLETED);
    expect(completed.clarifications?.[0]?.answer).toEqual({ optionId: 'local', by: 'auto', at: run.startedAt });
    const progression = events.filter((event) => event.type === 'clarification' || event.type === 'stage').slice(0, 5);
    expect(progression).toEqual([
      { type: 'stage', runId: run.id, stage: PipelineStage.SPECIFYING },
      { type: 'stage', runId: run.id, stage: PipelineStage.CLARIFYING },
      { type: 'clarification', runId: run.id, status: 'required' },
      { type: 'clarification', runId: run.id, status: 'answered' },
      { type: 'stage', runId: run.id, stage: PipelineStage.SPECIFYING },
    ]);
  });

  it('PSTUDIO-01 rejects a second question round without workspace writes', async () => {
    const h = harness([accepted], created, { autoClarify: true, pmOutput: () => ({ kind: 'questions', questions }) });
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Build storage' });
    const failed = await waitForTerminal(h.orchestrator, run.id);
    expect(failed.stage).toBe(PipelineStage.FAILED);
    expect(failed.failureReport?.error.code).toBe(ErrorCode.VALIDATION);
    expect(h.calls).toHaveLength(2);
    await expectNoUserWrites(h.fs);
  });

  it.each([false, true])(
    'PSTUDIO-01 keeps the project queued through waiting and resumed coding (restart=%s)',
    async (restart) => {
      const codingEntered = deferred();
      const releaseCoding = deferred();
      const h = harness([accepted], created, {
        pmOutput: askOnce,
        beforeRole: async (role) => {
          if (role === 'coder') {
            codingEntered.resolve();
            await releaseCoding.promise;
          }
        },
      });
      const first = await startRun(h.orchestrator, { projectId, prompt: 'First' });
      await vi.waitFor(() => {
        expect(h.rows.get(first.id)?.stage).toBe(PipelineStage.CLARIFYING);
      });
      const orchestrator = restart ? h.restart() : h.orchestrator;
      // No get/list before start: discovering the waiting row must restore its queue gate.
      const second = await startRun(orchestrator, { projectId, prompt: 'Second' });
      const third = await startRun(orchestrator, { projectId, prompt: 'Third' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(h.calls).toHaveLength(1);
      expect(await orchestrator.get(first.id)).toMatchObject({ stage: PipelineStage.CLARIFYING });
      const input = { runId: first.id, answers: [{ questionId: 'storage', optionId: 'cloud' }] };
      const [answer, duplicate] = await Promise.all([
        orchestrator.answerClarifications(input),
        orchestrator.answerClarifications(input),
      ]);
      expect(answer.ok).toBe(true);
      expect(duplicate).toMatchObject({ ok: false, error: { code: ErrorCode.VALIDATION } });
      await codingEntered.promise;
      expect(h.calls.map((call) => call.options.pipelineRunId)).toEqual([first.id, first.id, first.id]);
      releaseCoding.resolve();
      expect((await waitForTerminal(orchestrator, first.id)).stage).toBe(PipelineStage.COMPLETED);
      await vi.waitFor(() => {
        expect(h.rows.get(second.id)?.stage).toBe(PipelineStage.CLARIFYING);
      });
      expect(h.calls.filter((call) => call.role === 'pm').map((call) => call.options.pipelineRunId)).toEqual([
        first.id,
        first.id,
        second.id,
      ]);
      await orchestrator.cancel(second.id);
      await vi.waitFor(() => {
        expect(h.rows.get(third.id)?.stage).toBe(PipelineStage.CLARIFYING);
      });
      await orchestrator.cancel(third.id);
    },
  );

  it('PSTUDIO-01 cancels a waiting run after restart and unblocks its project', async () => {
    const h = harness([accepted], created, { pmOutput: askOnce });
    const first = await startRun(h.orchestrator, { projectId, prompt: 'First' });
    await vi.waitFor(() => {
      expect(h.rows.get(first.id)?.stage).toBe(PipelineStage.CLARIFYING);
    });
    const restarted = h.restart();
    const second = await startRun(restarted, { projectId, prompt: 'Second' });
    expect(await restarted.cancel(first.id)).toMatchObject({ stage: PipelineStage.CANCELLED });
    await vi.waitFor(() => {
      expect(h.rows.get(second.id)?.stage).toBe(PipelineStage.CLARIFYING);
    });
    await restarted.cancel(second.id);
    await expectNoUserWrites(h.fs);
  });

  it('PSTUDIO-01 honours cancellation while the first PM is returning questions', async () => {
    const entered = deferred();
    const release = deferred();
    const h = harness([accepted], created, {
      pmOutput: askOnce,
      beforeRole: async () => {
        entered.resolve();
        await release.promise;
      },
    });
    const run = await startRun(h.orchestrator, { projectId, prompt: 'First' });
    await entered.promise;
    await h.orchestrator.cancel(run.id);
    release.resolve();
    expect((await waitForTerminal(h.orchestrator, run.id)).stage).toBe(PipelineStage.CANCELLED);
  });
  it('updates pipeline cost after each role call and at completion', async () => {
    const h = harness();
    await h.rootDirectory;
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Create greeting' });
    expect(run.stage).toBe(PipelineStage.SPECIFYING);
    const completed = await waitForTerminal(h.orchestrator, run.id);
    expect(completed.stage, JSON.stringify(completed.failureReport)).toBe(PipelineStage.COMPLETED);
    expect(completed.cost.microUsd).toBe(40);
    expect(h.costReads).toBe(4);
    const file = await h.fs.readFile(`${root}/hello.txt`);
    expect(file.ok && new TextDecoder().decode(file.value)).toBe('hello');
  });

  it('TC-M6-004 fails after the one permitted rejected fix without writing files', async () => {
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
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Create greeting' });
    const failed = await waitForTerminal(h.orchestrator, run.id);
    expect(failed.stage).toBe(PipelineStage.FAILED);
    expect(failed.fixAttempts).toBe(1);
    const exists = await h.fs.exists(`${root}/hello.txt`);
    expect(exists.ok && exists.value).toBe(false);
  });

  it('TC-M6-003 runs one fix round and writes after the second review approves', async () => {
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
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Create greeting' });
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
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Create greeting' });
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
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Create greeting' });
    const result = await waitForTerminal(h.orchestrator, run.id);
    const after = await h.fs.readFile(`${root}/keep.txt`);
    expect(result.stage).toBe(PipelineStage.ROLLED_BACK);
    expect(before.ok ? [...before.value] : null).toEqual(after.ok ? [...after.value] : null);
    await expectNoUserWrites(h.fs);
  });

  it.each(['pm', 'coder', 'reviewer'] as const)('TC-M6-010 cancels during %s before writing', async (pausedRole) => {
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
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Create greeting' });
    await entered.promise;
    await h.orchestrator.cancel(run.id);
    release.resolve();
    expect((await waitForTerminal(h.orchestrator, run.id)).stage).toBe(PipelineStage.CANCELLED);
    await expectNoUserWrites(h.fs);
  });

  it('TC-M6-012 cancels during validation and rolls back the committed write', async () => {
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
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Create greeting' });
    await entered.promise;
    await h.orchestrator.cancel(run.id);
    release.resolve();
    expect((await waitForTerminal(h.orchestrator, run.id)).stage).toBe(PipelineStage.ROLLED_BACK);
    await expectNoUserWrites(h.fs);
  });

  it('TC-M6-011 cancels during writing and rolls back the committed write', async () => {
    const entered = deferred();
    const release = deferred();
    const h = harness([accepted], created, {
      beforeCommit: async () => {
        entered.resolve();
        await release.promise;
      },
    });
    await h.rootDirectory;
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Create greeting' });
    await entered.promise;
    await h.orchestrator.cancel(run.id);
    release.resolve();
    expect((await waitForTerminal(h.orchestrator, run.id)).stage).toBe(PipelineStage.ROLLED_BACK);
    await expectNoUserWrites(h.fs);
  });

  it('TC-M6-050 queues same-project runs and lists them in start order', async () => {
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
    const first = await startRun(h.orchestrator, { projectId, prompt: 'first' });
    await entered.promise;
    const second = await startRun(h.orchestrator, { projectId, prompt: 'second' });
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
    const first = await startRun(h.orchestrator, { projectId, prompt: 'first' });
    await firstEntered.promise;
    const second = await startRun(h.orchestrator, { projectId: secondProjectId, prompt: 'second' });
    await secondEntered.promise;
    release.resolve();
    expect((await waitForTerminal(h.orchestrator, first.id)).stage).toBe(PipelineStage.COMPLETED);
    expect((await waitForTerminal(h.orchestrator, second.id)).stage).toBe(PipelineStage.COMPLETED);
    expect(pmCalls).toBe(2);
  });

  it('TC-M6-051 stops at the pre-write budget boundary without writing', async () => {
    const h = harness([accepted], created, { hardStop: () => Promise.resolve(true) });
    await h.rootDirectory;
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Create greeting' });
    const result = await waitForTerminal(h.orchestrator, run.id);
    expect(result.stage).toBe(PipelineStage.FAILED);
    expect(result.failureReport?.error.code).toBe(ErrorCode.BUDGET_HARD_STOP);
    await expectNoUserWrites(h.fs);
  });

  it('TC-M6-051 rolls back when the budget hard stop is reached during validation', async () => {
    let checks = 0;
    const h = harness([accepted], created, {
      hardStop: () => Promise.resolve(++checks >= 5),
    });
    await h.rootDirectory;
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Create greeting' });
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
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Create greeting' });
    const result = await waitForTerminal(h.orchestrator, run.id);
    expect(result.stage).toBe(PipelineStage.ROLLED_BACK);
    expect(result.failureReport).toBeDefined();
    await expectNoUserWrites(h.fs);
    expect(reports).toBe(1);
  });

  it.each(['pm', 'coder', 'reviewer'] as const)('reports a %s role failure before writing', async (role) => {
    const h = harness([accepted], created, { roleFailure: role });
    await h.rootDirectory;
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Create greeting' });
    expect((await waitForTerminal(h.orchestrator, run.id)).stage).toBe(PipelineStage.FAILED);
    await expectNoUserWrites(h.fs);
  });

  it('reports an invalid project or settings result from start', async () => {
    const missingProject = harness([accepted], created, { projectMissing: true });
    expect(await missingProject.orchestrator.start({ projectId, prompt: 'Missing' })).toMatchObject({
      ok: false,
      error: { code: ErrorCode.VALIDATION, message: 'The project does not exist.' },
    });
    const failingSettings = harness([accepted], created, { settingsFailureCall: 1 });
    expect(await failingSettings.orchestrator.start({ projectId, prompt: 'No settings' })).toMatchObject({
      ok: false,
      error: { message: 'Injected settings failure.' },
    });
  });

  it('rolls back when validation settings cannot be reloaded', async () => {
    const h = harness([accepted], created, { settingsFailureCall: 2 });
    await h.rootDirectory;
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Create greeting' });
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
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Create greeting' });
    expect((await waitForTerminal(h.orchestrator, run.id)).stage).toBe(PipelineStage.ROLLED_BACK);
    await expectNoUserWrites(h.fs);
  });

  it('reports prepare errors without treating them as committed writes', async () => {
    const h = harness([accepted], created, { prepareFailure: true });
    await h.rootDirectory;
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Create greeting' });
    const result = await waitForTerminal(h.orchestrator, run.id);
    expect(result.stage).toBe(PipelineStage.ROLLED_BACK);
    expect(result.failureReport?.rolledBack).toBe(false);
    await expectNoUserWrites(h.fs);
  });

  it('rolls back when the transaction cannot be marked validated', async () => {
    const h = harness([accepted], created, { markValidatedFailure: true });
    await h.rootDirectory;
    const run = await startRun(h.orchestrator, { projectId, prompt: 'Create greeting' });
    expect((await waitForTerminal(h.orchestrator, run.id)).stage).toBe(PipelineStage.ROLLED_BACK);
    await expectNoUserWrites(h.fs);
  });
});
