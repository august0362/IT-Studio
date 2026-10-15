import type { ProcessId } from '@itstudio/schemas';
import { NO_PROCESS_TRACKER, type IProcessTracker } from '../ports/process-tracker.js';
import { trackProcess, ProcessActivity } from './process-activity.js';
import {
  ErrorCode,
  PipelineStage,
  type AppError,
  type CoderOutput,
  type FailureReport,
  type PipelineEvent,
  type PipelineRun,
  type PipelineRunId,
  type MicroUsd,
  type PipelineSettings,
  type Project,
  type ProjectId,
  type Result,
  type ReviewVerdict,
  type CommandRunId,
  type TaskSpec,
  type ClarificationQuestion,
  type RpcMethodMap,
  type ModelDescriptor,
  type ModelKey,
  type ProviderId,
} from '@itstudio/schemas';
import { PIPELINE_TRANSITIONS, transitionPipelineStage } from '../domain/pipeline-machine.js';
import type { IClock } from '../infra/clock.js';
import type { IIdGenerator } from '../infra/id.js';
import type { IFileSystem } from '../ports/file-system.js';
import type { EventBus } from '../rpc/event-bus.js';
import type { ProjectContextService } from './project-context.js';
import type { RoleCaller } from './role-caller.js';
import type { WriteTransactionService, PreparedWriteTransaction } from './write-transaction.js';
import type { CommandRunner } from './command-runner.js';
import type { FailureReportBuilder } from './failure-report-builder.js';
import type { IPipelineRepository } from '../infra/sqlite/pipeline-repository.js';
import { isoDateTimeSchema, microUsdSchema, pipelineRunIdSchema, transactionIdSchema } from '../validation/brand.js';
import { normalizeRelative, isForbidden, isWithinAllowed } from '../domain/path-guard.js';
import { providerName, remediationFor } from '../domain/remediation.js';
import { renderPipelineDiffs } from '../domain/pipeline-diff.js';

export interface IPipelineEligibility {
  load(): Promise<
    Result<{
      readonly models: readonly ModelDescriptor[];
      readonly configuredProviders: readonly ProviderId[];
      readonly eligibleModelKeys: readonly ModelKey[];
    }>
  >;
}

export interface PipelineOrchestratorDependencies {
  readonly processes?: IProcessTracker;
  readonly eligibility: IPipelineEligibility;
  readonly repository: IPipelineRepository;
  readonly projects: { get(id: ProjectId): Promise<Project | null> };
  readonly settings: () => Promise<Result<PipelineSettings>>;
  readonly context: ProjectContextService;
  readonly roles: Pick<RoleCaller, 'call'>;
  readonly writer: Pick<WriteTransactionService, 'prepare'>;
  readonly commands: Pick<CommandRunner, 'run'>;
  readonly reports: FailureReportBuilder;
  readonly fileSystem: IFileSystem;
  readonly events: Pick<
    EventBus<{ 'pipeline.event': PipelineEvent; 'pipeline.failureReport': FailureReport }>,
    'publish'
  >;
  readonly ids: IIdGenerator;
  readonly clock: IClock;
  readonly runCost: (runId: PipelineRunId) => Promise<MicroUsd>;
  readonly moneyDisplay: (amount: MicroUsd) => PipelineRun['cost'];
  readonly budgetHardStop?: (projectId: ProjectId) => Promise<boolean>;
}

function appError(message: string, code: AppError['code'] = ErrorCode.INTERNAL): AppError {
  return {
    code,
    message,
    retryable: false,
    remediation: ['Review the pipeline failure report and retry after resolving the issue.'],
  };
}

function safeOutput(output: CoderOutput, spec: TaskSpec): boolean {
  return output.operations.every((operation) => {
    const paths = operation.kind === 'rename' ? [operation.from, operation.to] : [operation.path];
    return paths.every((path) => {
      const normalized = normalizeRelative(path);
      return normalized.ok && !isForbidden(normalized.value) && isWithinAllowed(normalized.value, spec.allowedPaths);
    });
  });
}

export class PipelineOrchestrator {
  private readonly deps: PipelineOrchestratorDependencies;
  private readonly activities = new Map<PipelineRunId, ProcessActivity>();
  private readonly runs = new Map<PipelineRunId, PipelineRun>();
  private readonly cancelRequested = new Set<PipelineRunId>();
  private readonly validationControllers = new Map<PipelineRunId, AbortController>();
  private readonly tails = new Map<ProjectId, Promise<void>>();
  private readonly transactions = new Map<PipelineRunId, PreparedWriteTransaction>();
  private readonly restoredProjects = new Map<ProjectId, Promise<void>>();
  private readonly answering = new Set<PipelineRunId>();
  private readonly admitting = new Set<ProjectId>();
  private readonly clarificationGates = new Map<
    ProjectId,
    { readonly runId: PipelineRunId; readonly promise: Promise<void>; readonly release: () => void }
  >();

  constructor(dependencies: PipelineOrchestratorDependencies) {
    this.deps = dependencies;
  }

  isBusy(projectId: ProjectId): boolean {
    return this.admitting.has(projectId) || this.tails.has(projectId);
  }

  forgetProject(projectId: ProjectId): void {
    for (const [id, run] of this.runs) if (run.projectId === projectId) this.runs.delete(id);
    this.restoredProjects.delete(projectId);
  }

  async start(input: {
    readonly projectId: ProjectId;
    readonly prompt: string;
    readonly retryOf?: ProcessId;
  }): Promise<Result<PipelineRun>> {
    if (this.admitting.has(input.projectId))
      return {
        ok: false,
        error: appError('A pipeline start is already being admitted for this project.', ErrorCode.CONFLICT),
      };
    this.admitting.add(input.projectId);
    try {
      return await this.admit(input);
    } finally {
      this.admitting.delete(input.projectId);
    }
  }

  private async admit(input: {
    readonly projectId: ProjectId;
    readonly prompt: string;
    readonly retryOf?: ProcessId;
  }): Promise<Result<PipelineRun>> {
    const project = await this.deps.projects.get(input.projectId);
    if (project === null) return { ok: false, error: appError('The project does not exist.', ErrorCode.VALIDATION) };
    const settings = await this.deps.settings();
    if (!settings.ok) return settings;
    const eligibility = await this.deps.eligibility.load();
    if (!eligibility.ok) return eligibility;
    const { models, configuredProviders, eligibleModelKeys } = eligibility.value;
    const unavailableRoles = (['pm', 'coder', 'reviewer'] as const).filter(
      (role) => !settings.value.roleAssignment[role].some((key) => eligibleModelKeys.includes(key)),
    );
    if (unavailableRoles.length > 0) {
      const missingProviders = [
        ...new Set(
          unavailableRoles.flatMap((role) =>
            settings.value.roleAssignment[role].flatMap((key) => {
              const model = models.find((item) => item.key === key);
              return model !== undefined && !configuredProviders.includes(model.provider)
                ? [providerName(model.provider)]
                : [];
            }),
          ),
        ),
      ];
      const suggestedModels = models
        .filter((model) => eligibleModelKeys.includes(model.key))
        .slice(0, 3)
        .map((model) => `${providerName(model.provider)}: ${model.displayName}`);
      return {
        ok: false,
        error: {
          code: ErrorCode.VALIDATION,
          message: `No usable model for pipeline role(s): ${unavailableRoles.join(', ')}.`,
          retryable: false,
          remediation:
            missingProviders.length > 0
              ? remediationFor(ErrorCode.LADDER_EXHAUSTED, { missingProviders, suggestedModels })
              : [
                  `Add an enabled model with chat and JSON capabilities to each unavailable role in Settings → Pipeline.${suggestedModels.length ? ` Available models: ${suggestedModels.join(', ')}.` : ''}`,
                ],
        },
      };
    }
    await this.restoreWaitingRuns(input.projectId);
    const run: PipelineRun = {
      id: pipelineRunIdSchema.parse(this.deps.ids.uuid()),
      projectId: input.projectId,
      prompt: input.prompt,
      stage: PipelineStage.SPECIFYING,
      roleAssignment: settings.value.roleAssignment,
      coderOutputs: [],
      verdicts: [],
      fixAttempts: 0,
      cost: this.deps.moneyDisplay(microUsdSchema.parse(0)),
      startedAt: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
    };
    const activity = trackProcess(this.deps.processes, 'code_pipeline', {
      title: 'Code: ' + input.prompt.slice(0, 60),
      projectId: input.projectId,
      ref: { type: 'pipeline_run', id: run.id },
      operation: { kind: 'code_pipeline', params: { projectId: input.projectId, prompt: input.prompt } },
      cancel: async () => ({ ok: true, value: await this.cancel(run.id) }),
      ...(input.retryOf === undefined ? {} : { retryOf: input.retryOf }),
    });
    this.activities.set(run.id, activity);
    activity.done('request', 'Build request received');
    activity.skip('clarify');
    this.runs.set(run.id, run);
    await this.deps.repository.save(run);
    this.publishStage(run);
    const queued = this.tails.has(input.projectId) || this.clarificationGates.has(input.projectId);
    if (queued) activity.waiting('Queued behind another pipeline');
    const previous = this.tails.get(input.projectId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        await this.clarificationGates.get(input.projectId)?.promise;
        this.activities.get(run.id)?.step('spec');
        await this.execute(run.id, project);
        const gate = this.clarificationGates.get(input.projectId);
        if (gate?.runId === run.id) await gate.promise;
      });
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(input.projectId, tail);
    void current.finally(() => {
      if (this.tails.get(input.projectId) === tail) this.tails.delete(input.projectId);
    });
    return { ok: true, value: run };
  }

  async get(runId: PipelineRunId): Promise<PipelineRun | null> {
    const cached = this.runs.get(runId);
    if (cached !== undefined) return cached;
    const stored = await this.deps.repository.get(runId);
    if (stored === null) return null;
    const run = this.runs.get(runId) ?? stored;
    this.runs.set(runId, run);
    if (run.stage === PipelineStage.CLARIFYING) this.blockProjectForClarification(run.projectId, run.id);
    return run;
  }

  list(input: { readonly projectId: ProjectId; readonly limit: number }): Promise<readonly PipelineRun[]> {
    return this.deps.repository.list(input.projectId, Math.max(1, Math.min(200, input.limit)));
  }

  async cancel(runId: PipelineRunId): Promise<PipelineRun | null> {
    const run = await this.get(runId);
    if (run === null || isTerminal(run.stage)) return run;
    if (
      run.stage === PipelineStage.CLARIFYING &&
      !this.answering.has(runId) &&
      this.clarificationGates.get(run.projectId)?.runId === runId
    ) {
      const cancelled = await this.update(run, {
        stage: transitionPipelineStage(run.stage, 'cancel'),
        finishedAt: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
      });
      this.publishStage(cancelled);
      this.publishFinished(cancelled);
      this.releaseClarificationGate(run.projectId, run.id);
      this.cancelRequested.delete(runId);
      return cancelled;
    }
    this.cancelRequested.add(runId);
    this.validationControllers.get(runId)?.abort();
    return this.runs.get(runId) ?? run;
  }

  async answerClarifications(
    input: RpcMethodMap['pipeline.answerClarifications']['params'],
  ): Promise<Result<PipelineRun>> {
    if (this.answering.has(input.runId))
      return { ok: false, error: appError('This run is already processing answers.', ErrorCode.VALIDATION) };
    this.answering.add(input.runId);
    try {
      return await this.resumeWithAnswers(input);
    } finally {
      this.answering.delete(input.runId);
      const run = this.runs.get(input.runId);
      if (run?.stage === PipelineStage.CLARIFYING && this.cancelRequested.has(run.id)) await this.cancel(run.id);
    }
  }

  private async resumeWithAnswers(
    input: RpcMethodMap['pipeline.answerClarifications']['params'],
  ): Promise<Result<PipelineRun>> {
    const run = await this.get(input.runId);
    if (run?.stage !== PipelineStage.CLARIFYING || run.clarifications === undefined)
      return { ok: false, error: appError('This run is not waiting for clarifications.', ErrorCode.VALIDATION) };
    const answerMap = new Map(input.answers.map((answer) => [answer.questionId, answer]));
    if (answerMap.size !== input.answers.length || answerMap.size !== run.clarifications.length)
      return { ok: false, error: appError('Provide exactly one answer for every question.', ErrorCode.VALIDATION) };
    const answered: ClarificationQuestion[] = [];
    for (const question of run.clarifications) {
      const answer = answerMap.get(question.id);
      if (answer === undefined)
        return { ok: false, error: appError('Every clarification question needs an answer.', ErrorCode.VALIDATION) };
      const freeText = answer.freeText?.trim();
      const hasOption =
        answer.optionId !== undefined && question.options.some((option) => option.id === answer.optionId);
      if (
        (!hasOption && (freeText === undefined || freeText.length === 0 || freeText.length > 2000)) ||
        (answer.optionId !== undefined && !hasOption) ||
        (answer.freeText?.length ?? 0) > 2000
      )
        return {
          ok: false,
          error: appError('Choose a valid option or enter up to 2,000 characters of free text.', ErrorCode.VALIDATION),
        };
      answered.push({
        ...question,
        answer: {
          ...(answer.optionId === undefined ? {} : { optionId: answer.optionId }),
          ...(freeText === undefined || freeText.length === 0 ? {} : { freeText }),
          by: 'user',
          at: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
        },
      });
    }
    const project = await this.deps.projects.get(run.projectId);
    if (project === null) return { ok: false, error: appError('The project no longer exists.', ErrorCode.VALIDATION) };
    this.blockProjectForClarification(run.projectId, run.id);
    const resumed = await this.update(run, {
      clarifications: answered,
      stage: transitionPipelineStage(run.stage, 'answered'),
    });
    this.deps.events.publish('pipeline.event', { type: 'clarification', runId: run.id, status: 'answered' });
    this.publishStage(resumed);
    void this.execute(run.id, project).finally(() => {
      this.releaseClarificationGate(run.projectId, run.id);
    });
    return { ok: true, value: resumed };
  }

  private async execute(runId: PipelineRunId, project: Project): Promise<void> {
    let run = this.current(runId);
    try {
      if (this.isCancelled(run)) {
        await this.finish(run, PipelineStage.CANCELLED);
        return;
      }
      const context = await this.deps.context.build(project.workspaceRoot);
      const clarifications = run.clarifications;
      const specCall = await this.deps.roles.call(
        'pm',
        {
          prompt: run.prompt,
          ragHits: '',
          tree: context.tree,
          conventionsSummary: context.conventionsSummary,
          ...(clarifications === undefined ? {} : { clarifications }),
        },
        { projectId: run.projectId, pipelineRunId: run.id, ladder: run.roleAssignment.pm },
      );
      run = await this.refreshCost(run);
      if (!specCall.ok) {
        await this.fail(run, specCall.error, false);
        return;
      }
      if (this.isCancelled(run)) {
        await this.finish(run, PipelineStage.CANCELLED);
        return;
      }
      if (!('kind' in specCall.value)) {
        await this.fail(run, appError('The PM returned an invalid output.', ErrorCode.VALIDATION), false);
        return;
      }
      if (specCall.value.kind === 'questions') {
        if (clarifications !== undefined) {
          await this.fail(run, appError('The PM asked a second clarification round.', ErrorCode.VALIDATION), false);
          return;
        }
        const questions = specCall.value.questions;
        const settings = await this.deps.settings();
        if (!settings.ok) {
          await this.fail(run, settings.error, false);
          return;
        }
        if (settings.value.autoClarify) {
          const at = isoDateTimeSchema.parse(this.deps.clock.now().toISOString());
          run = await this.update(run, {
            clarifications: questions.map((question) => ({
              ...question,
              answer: { optionId: question.recommendedOptionId, by: 'auto', at },
            })),
          });
          run = await this.move(run, 'needs_clarification');
          this.deps.events.publish('pipeline.event', { type: 'clarification', runId: run.id, status: 'required' });
          this.deps.events.publish('pipeline.event', { type: 'clarification', runId: run.id, status: 'answered' });
          run = await this.move(run, 'answered');
          await this.execute(run.id, project);
          return;
        }
        this.blockProjectForClarification(run.projectId, run.id);
        run = await this.update(run, { clarifications: questions });
        run = await this.move(run, 'needs_clarification');
        this.deps.events.publish('pipeline.event', { type: 'clarification', runId: run.id, status: 'required' });
        if (this.isCancelled(run)) await this.finish(run, PipelineStage.CANCELLED);
        return;
      }
      const spec = specCall.value.spec;
      run = await this.update(run, { spec });
      run = await this.move(run, 'spec_ready');
      this.artifact(run, 'spec', 0);
      if (await this.checkBoundary(run)) return;

      const coding = await this.coder(run, project, spec, false);
      run = await this.refreshCost(run);
      if (!coding.ok) {
        await this.fail(run, coding.error, false);
        return;
      }
      run = await this.update(run, { coderOutputs: [...run.coderOutputs, coding.value] });
      run = await this.move(run, 'code_ready');
      this.artifact(run, 'code', 0);
      if (!safeOutput(coding.value, spec)) {
        await this.fail(
          run,
          appError('Coder operations include a path outside the allowed paths.', ErrorCode.PATH_OUTSIDE_WORKSPACE),
          false,
        );
        return;
      }
      if (await this.checkBoundary(run)) return;

      let verdict = await this.review(run, project, spec, coding.value);
      run = await this.refreshCost(run);
      if (!verdict.ok) {
        await this.fail(run, verdict.error, false);
        return;
      }
      run = await this.update(run, { verdicts: [...run.verdicts, verdict.value] });
      this.artifact(run, 'review', 0);
      if (!verdict.value.approved) {
        run = await this.move(run, 'rejected', { fixAttempts: 1 });
        if (await this.checkBoundary(run)) return;
        const fix = await this.coder(run, project, spec, true, verdict.value);
        run = await this.refreshCost(run);
        if (!fix.ok) {
          await this.fail(run, fix.error, false);
          return;
        }
        run = await this.update(run, { coderOutputs: [...run.coderOutputs, fix.value] });
        this.artifact(run, 'code', 1);
        if (!safeOutput(fix.value, spec)) {
          await this.fail(
            run,
            appError('Coder operations include a path outside the allowed paths.', ErrorCode.PATH_OUTSIDE_WORKSPACE),
            false,
          );
          return;
        }
        run = await this.move(run, 'fix_ready');
        if (await this.checkBoundary(run)) return;
        verdict = await this.review(run, project, spec, fix.value);
        run = await this.refreshCost(run);
        if (!verdict.ok) {
          await this.fail(run, verdict.error, false);
          return;
        }
        run = await this.update(run, { verdicts: [...run.verdicts, verdict.value] });
        this.artifact(run, 'review', 1);
        if (!verdict.value.approved) {
          await this.fail(run, appError('The reviewer rejected the change after the single allowed fix.'), false);
          return;
        }
        run = await this.move(run, 'approved');
      } else run = await this.move(run, 'approved');
      if (await this.checkBoundary(run)) return;
      const approved = run.coderOutputs.at(-1);
      if (approved === undefined) {
        await this.fail(run, appError('The approved coder output is missing.'), false);
        return;
      }

      if (await this.hardStopped(run)) {
        await this.fail(run, appError('Budget Hard Stop prevented writing.', ErrorCode.BUDGET_HARD_STOP), false);
        return;
      }
      const prepared = await this.deps.writer.prepare(
        project.workspaceRoot,
        run.projectId,
        approved.operations,
        spec.allowedPaths,
      );
      if (!prepared.ok) {
        await this.fail(run, prepared.error, false, true);
        return;
      }
      this.transactions.set(run.id, prepared.value);
      run = await this.update(run, { transactionId: transactionIdSchema.parse(prepared.value.transactionId) });
      const committed = await prepared.value.commit();
      if (!committed.ok) {
        await this.fail(run, committed.error, true, true);
        return;
      }
      run = await this.move(run, 'write_done');
      if (this.isCancelled(run)) {
        await this.fail(run, appError('Pipeline cancelled during workspace writing.', ErrorCode.INTERNAL), true, true);
        return;
      }

      const currentSettings = await this.deps.settings();
      if (!currentSettings.ok) {
        await this.fail(run, currentSettings.error, true, true);
        return;
      }
      const validation = [...(run.validation ?? [])];
      const validationController = new AbortController();
      this.validationControllers.set(run.id, validationController);
      for (const command of currentSettings.value.validationCommands) {
        const commandRun = await this.deps.commands.run(project.workspaceRoot, command, validationController.signal, {
          projectId: run.projectId,
          pipelineRunId: run.id,
        });
        if (!commandRun.ok) {
          await this.fail(run, commandRun.error, true, true, validation);
          return;
        }
        validation.push(commandRun.value);
        this.publishOutput(run, commandRun.value.id, 'stdout', commandRun.value.stdoutTail);
        this.publishOutput(run, commandRun.value.id, 'stderr', commandRun.value.stderrTail);
        run = await this.update(run, { validation });
        if (commandRun.value.timedOut || commandRun.value.exitCode !== 0) {
          await this.fail(
            run,
            appError(`Validation command ${command.kind} failed.`, ErrorCode.COMMAND_FAILED),
            true,
            true,
            validation,
          );
          return;
        }
        if (this.isCancelled(run)) {
          await this.fail(
            run,
            appError('Pipeline cancelled during validation.', ErrorCode.INTERNAL),
            true,
            true,
            validation,
          );
          return;
        }
        if (await this.hardStopped(run)) {
          await this.fail(
            run,
            appError('Budget Hard Stop stopped validation.', ErrorCode.BUDGET_HARD_STOP),
            true,
            true,
            validation,
          );
          return;
        }
      }
      this.validationControllers.delete(run.id);
      const marked = await prepared.value.markValidated();
      if (!marked.ok) {
        await this.fail(run, marked.error, true, true, validation);
        return;
      }
      this.transactions.delete(run.id);
      run = await this.move(run, 'validation_passed', { validation });
      await this.finish(run, PipelineStage.COMPLETED);
    } catch (error) {
      run = this.current(runId);
      await this.fail(
        run,
        appError(error instanceof Error ? error.message : 'Unexpected pipeline failure.'),
        this.transactions.has(runId),
        true,
      );
    }
  }

  private async coder(
    run: PipelineRun,
    project: Project,
    spec: TaskSpec,
    fixRound: boolean,
    verdict?: ReviewVerdict,
  ): Promise<Result<CoderOutput>> {
    const context = await this.deps.context.build(project.workspaceRoot, spec.allowedPaths);
    const result = await this.deps.roles.call(
      'coder',
      {
        spec,
        filesWithHashes: context.filesWithHashes,
        fixRound,
        ...(verdict === undefined ? {} : { findings: JSON.stringify(verdict.findings) }),
      },
      { projectId: run.projectId, pipelineRunId: run.id, ladder: run.roleAssignment.coder },
    );
    return result.ok ? { ok: true, value: result.value as CoderOutput } : result;
  }

  private async review(
    run: PipelineRun,
    project: Project,
    spec: TaskSpec,
    output: CoderOutput,
  ): Promise<Result<ReviewVerdict>> {
    const context = await this.deps.context.build(project.workspaceRoot, spec.allowedPaths);
    const diff = renderPipelineDiffs(output.operations, context.currentFiles);
    return this.deps.roles
      .call(
        'reviewer',
        { spec, coderOutput: output, diff },
        { projectId: run.projectId, pipelineRunId: run.id, ladder: run.roleAssignment.reviewer },
      )
      .then((result) => (result.ok ? { ok: true, value: result.value as ReviewVerdict } : result));
  }

  private async checkBoundary(run: PipelineRun): Promise<boolean> {
    if (this.isCancelled(run)) {
      await this.finish(run, PipelineStage.CANCELLED);
      return true;
    }
    if (await this.hardStopped(run)) {
      await this.fail(
        run,
        appError('Budget Hard Stop stopped the pipeline before writing.', ErrorCode.BUDGET_HARD_STOP),
        false,
      );
      return true;
    }
    return false;
  }

  private hardStopped(run: PipelineRun): Promise<boolean> {
    return this.deps.budgetHardStop?.(run.projectId) ?? Promise.resolve(false);
  }
  private isCancelled(run: PipelineRun): boolean {
    return this.cancelRequested.has(run.id);
  }

  private async move(
    run: PipelineRun,
    action: Parameters<typeof transitionPipelineStage>[1],
    patch: Partial<PipelineRun> = {},
  ): Promise<PipelineRun> {
    const stage = transitionPipelineStage(run.stage, action);
    const next = await this.update(run, { ...patch, stage });
    this.publishStage(next);
    return next;
  }

  private async update(run: PipelineRun, patch: Partial<PipelineRun>): Promise<PipelineRun> {
    const next = { ...run, ...patch };
    this.runs.set(next.id, next);
    await this.deps.repository.save(next);
    return next;
  }

  private async refreshCost(run: PipelineRun): Promise<PipelineRun> {
    const amount = await this.deps.runCost(run.id);
    return this.update(run, { cost: this.deps.moneyDisplay(amount) });
  }

  private async fail(
    run: PipelineRun,
    error: AppError,
    rollback: boolean,
    rolledBackStage = false,
    commandRuns: PipelineRun['validation'] = run.validation,
  ): Promise<void> {
    this.validationControllers.delete(run.id);
    run = await this.refreshCost(run);
    const transaction = this.transactions.get(run.id);
    let rolledBack = false;
    let finalError = error;
    if (rollback && transaction !== undefined) {
      const restored = await transaction.rollback();
      rolledBack = restored.ok;
      if (!restored.ok) finalError = restored.error;
      this.transactions.delete(run.id);
    }
    const terminal = rollback || rolledBackStage ? PipelineStage.ROLLED_BACK : PipelineStage.FAILED;
    const report = this.deps.reports.build({
      runId: run.id,
      stage: run.stage,
      error: finalError,
      rolledBack,
      ...(run.transactionId === undefined ? {} : { restoredSnapshot: run.transactionId }),
      ...(commandRuns === undefined ? {} : { commandRuns }),
      logLines: [finalError.message],
    });
    const finished = await this.update(run, {
      stage: terminal,
      failureReport: report,
      finishedAt: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
    });
    this.publishStage(finished);
    this.deps.events.publish('pipeline.failureReport', report);
    this.publishFinished(finished);
    this.releaseClarificationGate(run.projectId, run.id);
    this.cancelRequested.delete(run.id);
  }

  private async finish(run: PipelineRun, stage: PipelineRun['stage']): Promise<void> {
    run = await this.refreshCost(run);
    const finished = await this.update(run, {
      stage,
      finishedAt: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
    });
    this.publishStage(finished);
    this.publishFinished(finished);
    this.releaseClarificationGate(run.projectId, run.id);
    this.cancelRequested.delete(run.id);
  }

  private current(id: PipelineRunId): PipelineRun {
    const run = this.runs.get(id);
    if (run === undefined) throw new Error('Pipeline run was not found.');
    return run;
  }
  private blockProjectForClarification(projectId: ProjectId, runId: PipelineRunId): void {
    if (this.clarificationGates.get(projectId)?.runId === runId) return;
    let release: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.clarificationGates.set(projectId, { runId, promise, release });
  }
  private restoreWaitingRuns(projectId: ProjectId): Promise<void> {
    let pending = this.restoredProjects.get(projectId);
    if (pending === undefined) {
      pending = this.deps.repository.list(projectId, Number.MAX_SAFE_INTEGER).then((runs) => {
        for (const stored of runs) {
          const run = this.runs.get(stored.id) ?? stored;
          if (run.stage !== PipelineStage.CLARIFYING) continue;
          this.runs.set(run.id, run);
          this.blockProjectForClarification(projectId, run.id);
        }
      });
      this.restoredProjects.set(projectId, pending);
    }
    return pending;
  }
  private releaseClarificationGate(projectId: ProjectId, runId: PipelineRunId): void {
    const gate = this.clarificationGates.get(projectId);
    if (gate?.runId !== runId) return;
    this.clarificationGates.delete(projectId);
    gate.release();
  }
  private publishStage(run: PipelineRun): void {
    let activity = this.activities.get(run.id);
    if (activity === undefined) {
      const tracker = this.deps.processes ?? NO_PROCESS_TRACKER;
      const id = tracker.find('code_pipeline', run.id);
      if (id !== undefined) {
        activity = new ProcessActivity(tracker, id, 'clarify');
        this.activities.set(run.id, activity);
      }
    }
    if (activity !== undefined) {
      activity.annotate({ costText: run.cost.usdText + '\n' + run.cost.vndText });
      const moduleId = PIPELINE_PROCESS_MODULE[run.stage];
      if (run.stage === PipelineStage.COMPLETED) {
        activity.step('done');
        activity.finish('Project build completed');
        this.activities.delete(run.id);
      } else if (isTerminal(run.stage)) {
        activity.fail(run.failureReport?.error ?? 'Pipeline ' + run.stage);
        this.activities.delete(run.id);
      } else if (moduleId !== undefined) {
        activity.step(moduleId, undefined, {
          stage: run.stage,
          files: run.coderOutputs.at(-1)?.operations.length ?? 0,
        });
        if (run.stage === PipelineStage.CLARIFYING) activity.waiting('Waiting for your answers');
      }
    }
    this.deps.events.publish('pipeline.event', { type: 'stage', runId: run.id, stage: run.stage });
  }
  private artifact(run: PipelineRun, kind: 'spec' | 'code' | 'review', index: number): void {
    this.deps.events.publish('pipeline.event', { type: 'artifact', runId: run.id, kind, index });
  }
  private publishOutput(
    run: PipelineRun,
    commandRunId: CommandRunId,
    stream: 'stdout' | 'stderr',
    output: string,
  ): void {
    for (let index = 0; index < output.length; index += 4096)
      this.deps.events.publish('pipeline.event', {
        type: 'command_output',
        runId: run.id,
        commandRunId,
        stream,
        chunk: output.slice(index, index + 4096),
      });
  }
  private publishFinished(run: PipelineRun): void {
    const terminal = run.stage;
    if (
      terminal === PipelineStage.COMPLETED ||
      terminal === PipelineStage.ROLLED_BACK ||
      terminal === PipelineStage.FAILED ||
      terminal === PipelineStage.CANCELLED
    )
      this.deps.events.publish('pipeline.event', { type: 'finished', runId: run.id, stage: terminal });
  }
}

function isTerminal(stage: PipelineRun['stage']): boolean {
  return (
    stage === PipelineStage.COMPLETED ||
    stage === PipelineStage.ROLLED_BACK ||
    stage === PipelineStage.FAILED ||
    stage === PipelineStage.CANCELLED
  );
}

export const pipelineTransitionTable = PIPELINE_TRANSITIONS;

const PIPELINE_PROCESS_MODULE: Readonly<Partial<Record<PipelineRun['stage'], string>>> = {
  specifying: 'spec',
  clarifying: 'clarify',
  coding: 'code',
  reviewing: 'review',
  fixing: 'fix',
  re_reviewing: 're_review',
  writing: 'write',
  validating: 'validate',
};
