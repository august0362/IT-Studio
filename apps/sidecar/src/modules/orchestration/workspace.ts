import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  ErrorCode,
  type CoderOutput,
  type CommandRun,
  type CommandSpec,
  type OrchRun,
  type OrchTask,
  type Project,
  type ProjectId,
  type Result,
} from '@itstudio/schemas';
import type { IProjectLifecycleRepository } from '../../kernel/ports/project-repository.js';
import type { IProcessRunner } from '../../kernel/ports/process-runner.js';
import { coderOutputSchema } from '../../kernel/validation/pipeline.js';
import {
  applyWorkerOutput,
  globMatches,
  type Worktree,
  type WorktreeManager,
  type WorkerApplyDependencies,
} from './worktrees.js';

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
  /** Tracked files and the current content + sha256 of files inside `allowedPaths` (worker context). */
  workerContext?(worktree: Worktree, allowedPaths: readonly string[]): Promise<Result<WorkerContext>>;
  /** Root, current branch and tracked files of the run's project (supervisor planning context). */
  projectInfo?(projectId: ProjectId): Promise<Result<ProjectInfo>>;
}
export interface WorkerContextFile {
  readonly path: string;
  readonly sha256: string;
  /** Omitted when the file is binary or too large; the worker may still read it from its worktree. */
  readonly content?: string;
}
export interface WorkerContext {
  readonly tree: readonly string[];
  readonly files: readonly WorkerContextFile[];
}
export interface ProjectInfo {
  readonly root: string;
  readonly branch: string;
  readonly tree: readonly string[];
}
const MAX_TREE_ENTRIES = 400;
const MAX_CONTEXT_FILE_BYTES = 64 * 1024;
const MAX_CONTEXT_TOTAL_BYTES = 512 * 1024;
const MAX_DIFF_CHARS = 200_000;
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
      args: ['merge', '--no-ff', '-m', `Merge ${taskWorktree.branch}`, taskWorktree.branch],
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
      maxOutputBytes: 4 * 1024 * 1024,
    });
    if (!result.ok) return result;
    if (result.value.exitCode !== 0)
      return {
        ok: false,
        error: { code: ErrorCode.COMMAND_FAILED, message: 'Could not read the worktree diff.', retryable: false },
      };
    const diff = result.value.stdoutTail;
    return {
      ok: true,
      value:
        diff.length > MAX_DIFF_CHARS
          ? `${diff.slice(0, MAX_DIFF_CHARS)}\n[diff truncated: ${String(diff.length - MAX_DIFF_CHARS)} more characters]`
          : diff,
    };
  }
  private async trackedFiles(root: string): Promise<Result<readonly string[]>> {
    const listed = await this.deps.runner.run({
      executable: 'git',
      args: ['ls-files'],
      cwd: root,
      env: process.env,
      timeoutMs: 30_000,
      maxOutputBytes: 4 * 1024 * 1024,
    });
    if (!listed.ok) return listed;
    if (listed.value.exitCode !== 0)
      return {
        ok: false,
        error: { code: ErrorCode.COMMAND_FAILED, message: 'Could not list the project files.', retryable: false },
      };
    return {
      ok: true,
      value: listed.value.stdoutTail
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    };
  }
  async workerContext(worktree: Worktree, allowedPaths: readonly string[]): Promise<Result<WorkerContext>> {
    const tracked = await this.trackedFiles(worktree.path);
    if (!tracked.ok) return tracked;
    const files: WorkerContextFile[] = [];
    let total = 0;
    for (const path of tracked.value) {
      if (!allowedPaths.some((pattern) => globMatches(pattern, path))) continue;
      const read = await this.deps.apply.fileSystem.readFile(join(worktree.path, path));
      if (!read.ok) continue;
      const sha256 = createHash('sha256').update(read.value).digest('hex');
      const text = read.value.includes(0) ? undefined : new TextDecoder('utf-8').decode(read.value);
      const fits =
        text !== undefined &&
        read.value.byteLength <= MAX_CONTEXT_FILE_BYTES &&
        total + read.value.byteLength <= MAX_CONTEXT_TOTAL_BYTES;
      if (fits) total += read.value.byteLength;
      files.push(fits ? { path, sha256, content: text } : { path, sha256 });
    }
    return { ok: true, value: { tree: tracked.value.slice(0, MAX_TREE_ENTRIES), files } };
  }
  /** Orchestration works in Git worktrees: the project must be the root of a Git repository with a commit. */
  private async checkRepository(root: string): Promise<Result<void>> {
    const invalid = (message: string, remediation: string): Result<never> => ({
      ok: false,
      error: { code: ErrorCode.VALIDATION, message, remediation: [remediation], retryable: false },
    });
    const folder = await this.deps.apply.fileSystem.stat(root);
    if (!folder.ok || !folder.value.isDirectory)
      return invalid(
        `The project folder ${root} does not exist.`,
        'Open a project whose folder exists, or restore the folder.',
      );
    const git = (args: readonly string[]) =>
      this.deps.runner.run({ executable: 'git', args, cwd: root, env: process.env, timeoutMs: 30_000 });
    const top = await git(['rev-parse', '--show-toplevel']);
    if (!top.ok)
      return invalid('Git was not found on this computer.', 'Install Git for Windows, then restart IT Studio.');
    if (top.value.exitCode !== 0)
      return invalid(
        `Orchestration needs a Git repository, but ${root} is not one. Run "git init" in that folder and commit your files, or open a project that is a Git repository.`,
        'Run "git init", "git add -A" and "git commit" in the project folder.',
      );
    const repositoryRoot = top.value.stdoutTail.trim();
    if (resolve(repositoryRoot).toLocaleLowerCase() !== resolve(root).toLocaleLowerCase())
      return invalid(
        `${root} is inside the Git repository ${resolve(repositoryRoot)}. Open the repository root as the project.`,
        'Create the project from the repository root folder.',
      );
    const head = await git(['rev-parse', '--verify', 'HEAD']);
    if (!head.ok || head.value.exitCode !== 0)
      return invalid(
        `The Git repository ${root} has no commits yet. Commit your files once, then plan again.`,
        'Run "git add -A" and "git commit" in the project folder.',
      );
    return { ok: true, value: undefined };
  }
  async projectInfo(projectId: ProjectId): Promise<Result<ProjectInfo>> {
    const project = await this.deps.projects.get(projectId);
    if (project === null)
      return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Project was not found.', retryable: false } };
    const ready = await this.checkRepository(project.workspaceRoot);
    if (!ready.ok) return ready;
    const tracked = await this.trackedFiles(project.workspaceRoot);
    if (!tracked.ok) return tracked;
    const branch = await this.deps.runner.run({
      executable: 'git',
      args: ['rev-parse', '--abbrev-ref', 'HEAD'],
      cwd: project.workspaceRoot,
      env: process.env,
      timeoutMs: 30_000,
    });
    const name = branch.ok && branch.value.exitCode === 0 ? branch.value.stdoutTail.trim() : '';
    return {
      ok: true,
      value: {
        root: project.workspaceRoot,
        branch: name.length > 0 && name !== 'HEAD' ? name : 'main',
        tree: tracked.value.slice(0, MAX_TREE_ENTRIES),
      },
    };
  }
  async cleanup(run: OrchRun, worktree: Worktree): Promise<Result<void>> {
    const project = await this.deps.projects.get(run.projectId);
    if (project === null)
      return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Project was not found.', retryable: false } };
    return this.deps.worktrees.cleanup(project.workspaceRoot, worktree);
  }
}
