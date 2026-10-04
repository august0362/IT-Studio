import { ErrorCode, type CommandRun, type CommandSpec, type Result } from '@itstudio/schemas';
import { commandRunIdSchema } from '../validation/brand.js';
import type { IFileSystem } from '../ports/file-system.js';
import type { IProcessRunner } from '../ports/process-runner.js';
import type { IIdGenerator } from '../infra/id.js';
import { parseEslintOutput } from '../domain/parsers/eslint.js';
import { parseFailureDiagnostic, parseTscOutput } from '../domain/parsers/tsc.js';
import { parseVitestOutput } from '../domain/parsers/vitest.js';
import { basename } from 'node:path';
import type { PipelineRunId, ProjectId } from '@itstudio/schemas';
import type { WorkflowInternalEventBus } from './workflow-internal-events.js';

export interface CommandRunnerDependencies {
  readonly processRunner: IProcessRunner;
  readonly fileSystem: IFileSystem;
  readonly ids: IIdGenerator;
  readonly env?: NodeJS.ProcessEnv;
  readonly internalEvents?: WorkflowInternalEventBus;
}

export class CommandRunner {
  private readonly processRunner: IProcessRunner;
  private readonly fileSystem: IFileSystem;
  private readonly ids: IIdGenerator;
  private readonly env: NodeJS.ProcessEnv;
  private readonly internalEvents: WorkflowInternalEventBus | undefined;

  constructor(dependencies: CommandRunnerDependencies) {
    this.processRunner = dependencies.processRunner;
    this.fileSystem = dependencies.fileSystem;
    this.ids = dependencies.ids;
    this.env = dependencies.env ?? process.env;
    this.internalEvents = dependencies.internalEvents;
  }

  async run(
    projectRoot: string,
    spec: CommandSpec,
    signal?: AbortSignal,
    context?: { readonly projectId: ProjectId; readonly pipelineRunId: PipelineRunId },
  ): Promise<Result<CommandRun>> {
    const root = await this.fileSystem.realpath(projectRoot);
    if (!root.ok) return root;
    const stat = await this.fileSystem.stat(root.value);
    if (!stat.ok) return stat;
    if (!stat.value.isDirectory)
      return {
        ok: false,
        error: {
          code: ErrorCode.VALIDATION,
          message: 'The project root must be a directory.',
          remediation: ['Choose an existing project directory and try again.'],
          retryable: false,
        },
      };

    const commandRunId = commandRunIdSchema.parse(this.ids.uuid());
    const executable = basename(spec.executable);
    this.internalEvents?.publish({
      type: 'command',
      phase: 'started',
      ...(context ?? {}),
      commandRunId,
      executable,
      argCount: spec.args.length,
    });
    const run = await this.processRunner.run({
      executable: spec.executable,
      args: spec.args,
      cwd: root.value,
      env: this.env,
      timeoutMs: spec.timeoutMs,
      ...(signal === undefined ? {} : { signal }),
    });
    if (!run.ok) {
      this.internalEvents?.publish({
        type: 'command',
        phase: 'finished',
        ...(context ?? {}),
        commandRunId,
        executable,
        argCount: spec.args.length,
        exitCode: null,
        timedOut: false,
      });
      return run;
    }
    this.internalEvents?.publish({
      type: 'command',
      phase: 'finished',
      ...(context ?? {}),
      commandRunId,
      executable,
      argCount: spec.args.length,
      exitCode: run.value.exitCode,
      durationMs: run.value.durationMs,
      timedOut: run.value.timedOut,
    });

    let diagnostics;
    let tests: CommandRun['tests'];
    if (spec.kind === 'typecheck') {
      diagnostics = parseTscOutput(run.value.stdoutTail, root.value);
      if (run.value.stdoutTail.trim().length > 0 && diagnostics.length === 0)
        diagnostics = [parseFailureDiagnostic('tsc')];
    } else if (spec.kind === 'lint') {
      diagnostics = parseEslintOutput(run.value.stdoutTail, root.value);
    } else if (spec.kind === 'test') {
      const parsed = parseVitestOutput(run.value.stdoutTail, root.value);
      diagnostics = parsed.diagnostics;
      tests = parsed.tests;
    } else {
      diagnostics = [];
    }

    return {
      ok: true,
      value: {
        id: commandRunId,
        spec,
        exitCode: run.value.exitCode,
        timedOut: run.value.timedOut,
        durationMs: run.value.durationMs,
        stdoutTail: run.value.stdoutTail,
        stderrTail: run.value.stderrTail,
        diagnostics,
        ...(tests ? { tests } : {}),
      },
    };
  }
}
