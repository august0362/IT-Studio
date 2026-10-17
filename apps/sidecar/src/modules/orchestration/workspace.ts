import { resolve } from 'node:path';
import {
  ErrorCode,
  type CoderOutput,
  type CommandRun,
  type CommandSpec,
  type OrchRun,
  type OrchTask,
  type Project,
  type Result,
} from '@itstudio/schemas';
import type { IProjectLifecycleRepository } from '../../ports/project-repository.js';
import type { IProcessRunner } from '../../ports/process-runner.js';
import { coderOutputSchema } from '../../validation/pipeline.js';
import { applyWorkerOutput, type Worktree, type WorktreeManager, type WorkerApplyDependencies } from './worktrees.js';

export function isTargetForbidden(
  projectRoot: string,
  sidecarCwd: string = process.cwd(),
  appExecutableDir?: string,
): boolean {
  const normProject = resolve(projectRoot).toLocaleLowerCase();
  const normCwd = resolve(sidecarCwd).toLocaleLowerCase();
  if (normProject === normCwd || normProject.startsWith(normCwd + '\\') || normProject.startsWith(normCwd + '/')) {
    return true;
  }
  if (appExecutableDir !== undefined && appExecutableDir.length > 0) {
    const normExe = resolve(appExecutableDir).toLocaleLowerCase();
    if (normProject === normExe || normProject.startsWith(normExe + '\\') || normProject.startsWith(normExe + '/')) {
      return true;
    }
  }
  return false;
}

export interface AttemptResult {
  readonly changedFiles: readonly string[];
  readonly baseSha: string;
  readonly headSha: string;
  readonly evidence: readonly CommandRun[];
}
export interface MergeTaskResult {
  readonly exitCode: number;
  readonly conflict: boolean;
  readonly diff?: string;
}
export interface IOrchWorkspace {
  prepareAttempt(run: OrchRun, task: OrchTask, attempt: number): Promise<Result<Worktree>>;
  prepareIntegration(run: OrchRun): Promise<Result<Worktree>>;
  mergeTask(run: OrchRun, integration: Worktree, taskWorktree: Worktree): Promise<Result<MergeTaskResult>>;
  validateIntegration(
    run: OrchRun,
    integration: Worktree,
    commands?: readonly CommandSpec[],
  ): Promise<Result<readonly CommandRun[]>>;
  applyWorker(
    run: OrchRun,
    task: OrchTask,
    attempt: number,
    worktree: Worktree,
    output: CoderOutput,
    signal?: AbortSignal,
  ): Promise<Result<AttemptResult>>;
  diff(worktree: Worktree): Promise<Result<string>>;
  cleanup(run: OrchRun, worktree: Worktree): Promise<Result<void>>;
}
export interface OrchWorkspaceDependencies {
  readonly projects: Pick<IProjectLifecycleRepository, 'get'>;
  readonly worktrees: WorktreeManager;
  readonly apply: Omit<WorkerApplyDependencies, 'projectId'>;
  readonly runner: IProcessRunner;
  readonly sidecarCwd?: string;
  readonly appExecutableDir?: string;
}
export class OrchWorkspace implements IOrchWorkspace {
  private readonly deps: OrchWorkspaceDependencies;
  private readonly baseShas = new Map<string, string>();
  constructor(deps: OrchWorkspaceDependencies) {
    this.deps = deps;
  }
  private async getBaseSha(workspaceRoot: string, runId: string): Promise<Result<string>> {
    let baseSha = this.baseShas.get(runId);
    if (baseSha === undefined) {
      const head = await this.deps.runner.run({
        executable: 'git',
        args: ['rev-parse', 'HEAD'],
        cwd: workspaceRoot,
        env: process.env,
        timeoutMs: 30_000,
      });
      if (!head.ok) return head;
      if (head.value.exitCode !== 0)
        return {
          ok: false,
          error: { code: ErrorCode.COMMAND_FAILED, message: 'Could not read the project base SHA.', retryable: false },
        };
      baseSha = head.value.stdoutTail.trim();
      this.baseShas.set(runId, baseSha);
    }
    return { ok: true, value: baseSha };
  }
  async prepareAttempt(run: OrchRun, task: OrchTask, attempt: number): Promise<Result<Worktree>> {
    const project: Project | null = await this.deps.projects.get(run.projectId);
    if (project === null)
      return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Project was not found.', retryable: false } };
    if (isTargetForbidden(project.workspaceRoot, this.deps.sidecarCwd, this.deps.appExecutableDir))
      return {
        ok: false,
        error: {
          code: ErrorCode.TARGET_FORBIDDEN,
          message: 'Refusing to run orchestration targeting IT Studio repository or install directory.',
          retryable: false,
        },
      };
    const baseSha = await this.getBaseSha(project.workspaceRoot, run.id);
    if (!baseSha.ok) return baseSha;
    return this.deps.worktrees.create(
      project.workspaceRoot,
      { runId: run.id, taskId: task.id, attempt, baseSha: baseSha.value },
      task.allowedPaths,
    );
  }
  async prepareIntegration(run: OrchRun): Promise<Result<Worktree>> {
    const project: Project | null = await this.deps.projects.get(run.projectId);
    if (project === null)
      return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Project was not found.', retryable: false } };
    if (isTargetForbidden(project.workspaceRoot, this.deps.sidecarCwd, this.deps.appExecutableDir))
      return {
        ok: false,
        error: {
          code: ErrorCode.TARGET_FORBIDDEN,
          message: 'Refusing to run orchestration targeting IT Studio repository or install directory.',
          retryable: false,
        },
      };
    const baseSha = await this.getBaseSha(project.workspaceRoot, run.id);
    if (!baseSha.ok) return baseSha;
    return this.deps.worktrees.createIntegration(project.workspaceRoot, run.id, baseSha.value);
  }
  async mergeTask(_run: OrchRun, integration: Worktree, taskWorktree: Worktree): Promise<Result<MergeTaskResult>> {
    const merged = await this.deps.runner.run({
      executable: 'git',
      args: ['merge', '--no-ff', taskWorktree.branch],
      cwd: integration.path,
      env: process.env,
      timeoutMs: 30_000,
    });
    if (!merged.ok) return merged;
    if (merged.value.exitCode !== 0) {
      const diffResult = await this.deps.runner.run({
        executable: 'git',
        args: ['diff'],
        cwd: integration.path,
        env: process.env,
        timeoutMs: 30_000,
      });
      return {
        ok: true,
        value: {
          exitCode: merged.value.exitCode ?? 1,
          conflict: true,
          diff: diffResult.ok ? diffResult.value.stdoutTail : '',
        },
      };
    }
    return { ok: true, value: { exitCode: 0, conflict: false } };
  }
  async validateIntegration(
    _run: OrchRun,
    integration: Worktree,
    commands: readonly CommandSpec[] = [],
  ): Promise<Result<readonly CommandRun[]>> {
    const runs: CommandRun[] = [];
    for (const cmd of commands) {
      const res = await this.deps.apply.commands.run(integration.path, cmd);
      if (!res.ok) return res;
      runs.push(res.value);
    }
    return { ok: true, value: runs };
  }
  async applyWorker(
    run: OrchRun,
    task: OrchTask,
    attempt: number,
    worktree: Worktree,
    output: CoderOutput,
    signal?: AbortSignal,
  ): Promise<Result<AttemptResult>> {
    const parsed = coderOutputSchema.safeParse(output);
    if (!parsed.success)
      return {
        ok: false,
        error: { code: ErrorCode.VALIDATION, message: 'Worker output is invalid.', retryable: false },
      };
    return applyWorkerOutput(
      { ...this.deps.apply, projectId: run.projectId },
      worktree,
      run.id,
      task.id,
      attempt,
      task.allowedPaths,
      task.testCommands,
      parsed.data,
      signal,
    );
  }
  async diff(worktree: Worktree): Promise<Result<string>> {
    const result = await this.deps.runner.run({
      executable: 'git',
      args: ['diff', `${worktree.baseSha}..HEAD`],
      cwd: worktree.path,
      env: process.env,
      timeoutMs: 30_000,
    });
    if (!result.ok) return result;
    return result.value.exitCode === 0
      ? { ok: true, value: result.value.stdoutTail }
      : {
          ok: false,
          error: { code: ErrorCode.COMMAND_FAILED, message: 'Could not read the worktree diff.', retryable: false },
        };
  }
  async cleanup(run: OrchRun, worktree: Worktree): Promise<Result<void>> {
    const project = await this.deps.projects.get(run.projectId);
    if (project === null)
      return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Project was not found.', retryable: false } };
    return this.deps.worktrees.cleanup(project.workspaceRoot, worktree);
  }
}
