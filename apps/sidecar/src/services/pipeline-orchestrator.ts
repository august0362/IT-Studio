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
import { renderPipelineDiffs } from '../domain/pipeline-diff.js';

export interface PipelineOrchestratorDependencies {
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
  private readonly runs = new Map<PipelineRunId, PipelineRun>();
  private readonly cancelRequested = new Set<PipelineRunId>();
  private readonly validationControllers = new Map<PipelineRunId, AbortController>();
  private readonly tails = new Map<ProjectId, Promise<void>>();
  private readonly transactions = new Map<PipelineRunId, PreparedWriteTransaction>();

  constructor(dependencies: PipelineOrchestratorDependencies) {
    this.deps = dependencies;
  }

  async start(input: { readonly projectId: ProjectId; readonly prompt: string }): Promise<PipelineRun> {
    const project = await this.deps.projects.get(input.projectId);
    if (project === null) throw new Error('The project does not exist.');
    const settings = await this.deps.settings();
    if (!settings.ok) throw new Error(settings.error.message);
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
    this.runs.set(run.id, run);
    await this.deps.repository.save(run);
    this.publishStage(run);
    const previous = this.tails.get(input.projectId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this.execute(run.id, project));
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(input.projectId, tail);
    void current.finally(() => {
      if (this.tails.get(input.projectId) === tail) this.tails.delete(input.projectId);
    });
    return run;
  }

  async get(runId: PipelineRunId): Promise<PipelineRun | null> {
    return this.runs.get(runId) ?? this.deps.repository.get(runId);
  }

  list(input: { readonly projectId: ProjectId; readonly limit: number }): Promise<readonly PipelineRun[]> {
    return this.deps.repository.list(input.projectId, Math.max(1, Math.min(200, input.limit)));
  }

  async cancel(runId: PipelineRunId): Promise<PipelineRun | null> {
    const run = await this.get(runId);
    if (run === null || isTerminal(run.stage)) return run;
    this.cancelRequested.add(runId);
    this.validationControllers.get(runId)?.abort();
    return this.runs.get(runId) ?? run;
  }

  private async execute(runId: PipelineRunId, project: Project): Promise<void> {
    let run = this.current(runId);
    try {
      if (this.isCancelled(run)) {
        await this.finish(run, PipelineStage.CANCELLED);
        return;
      }
      const context = await this.deps.context.build(project.workspaceRoot);
      const specCall = await this.deps.roles.call(
        'pm',
        { prompt: run.prompt, ragHits: '', tree: context.tree, conventionsSummary: context.conventionsSummary },
        { projectId: run.projectId, pipelineRunId: run.id, ladder: run.roleAssignment.pm },
      );
      run = await this.refreshCost(run);
      if (!specCall.ok) {
        await this.fail(run, specCall.error, false);
        return;
      }
      const spec = specCall.value as TaskSpec;
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
        const commandRun = await this.deps.commands.run(project.workspaceRoot, command, validationController.signal);
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
    this.cancelRequested.delete(run.id);
  }

  private current(id: PipelineRunId): PipelineRun {
    const run = this.runs.get(id);
    if (run === undefined) throw new Error('Pipeline run was not found.');
    return run;
  }
  private publishStage(run: PipelineRun): void {
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
