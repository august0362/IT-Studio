# ORCH-02C — Worker attempts write into a worktree; invalid reviews never pass

Role: Implementer · Size S · Model: gpt-6-luna medium · Deps pre-installed (node_modules complete; never run npm install) · Scope: `apps/sidecar/src/modules/orchestration/engine.ts`, `engine.test.ts` (create if missing), `worktrees.ts` (only if a helper signature must change), this task file.

## Exact changes in `engine.ts` (`OrchestrationEngine.run`, the `invoke` closure at ~line 73 and the review block at ~line 225)

1. Add optional dependency `worktrees?: Pick<WorktreeManager, 'create' | 'diff'>` and `applyWorkerOutput?: typeof applyWorkerOutput` to `OrchestrationEngineDependencies` (both imported from `./worktrees.js`).
2. In `invoke`, when `role === 'worker'` and `this.deps.worktrees` is set: before calling the adapter, `const wt = await this.deps.worktrees.create(run.id, task.id, attemptNo)` (attemptNo = number of previous worker attempts for this task + 1); set `envelope.assignedWorktree = wt.path` and remove `'write-to-disk'` from `forbiddenActions`. After a successful adapter result, call `this.deps.applyWorkerOutput(wt, task, payload)`; if it returns an error (`PATH_DENIED`, `ROLE_ACK_MISMATCH`, test failure), the attempt is `failed` with that reason; otherwise copy `changedFiles`, `baseSha`, `headSha`, `evidence` onto the attempt.
3. Reviewer input gets `diff: await this.deps.worktrees.diff(wt)` when worktrees are configured.
4. **Invalid reviewer output must not pass:** replace the fallback `{ verdict: 'pass', … 'Mock review passed.' }` with: invalid verdict ⇒ review attempt `failed`, reason `REVIEW_INVALID`; treat it like `fix_required` with a synthetic finding "Reviewer returned an invalid verdict" (counts toward `maxFixRounds`).
5. Without `worktrees` (unit tests with the mock adapter), behaviour stays as today except rule 4.

## Tests (`engine.test.ts`, names prefixed)

- `ORCH-005` — worker envelope has `roleId: 'worker'`, the task's `allowedPaths`, the created worktree path and a unique attemptId; an adapter result whose ack does not match ⇒ attempt `failed` `ROLE_ACK_MISMATCH` and `applyWorkerOutput` is never called (spy).
- `ORCH-006 (unit)` — `applyWorkerOutput` stub returns `PATH_DENIED` ⇒ attempt failed with that reason, task does not reach review.
- `REVIEW_INVALID` — reviewer returns `{}` ⇒ task does not complete; after `maxFixRounds` it escalates like ORCH-009.

Run prettier, `npm run typecheck`, `npm run lint`, `npx vitest run --project sidecar apps/sidecar/src/modules/orchestration`. Append `## Result`.

## Blocked
- Question: What project root/base SHA and worker apply infrastructure should the engine use for `WorktreeManager.create` and `applyWorkerOutput`? The task requires calls shaped as `create(run.id, task.id, attemptNo)`, `diff(wt)`, and `applyWorkerOutput(wt, task, payload)`, but the scoped helpers currently require project root + `WorktreeIdentity` + owned paths, and `WorkerApplyDependencies` + run/task/attempt IDs + test commands + output. `OrchRun` has no project root, and no worktree manager or apply dependencies are wired into the orchestration module/container.
- Tried: inspected `engine.ts`, `worktrees.ts`, orchestration module wiring in `index.ts`, schemas, and existing tests. There is no scoped source for those missing runtime dependencies. Changing helper signatures alone cannot supply the missing project root or filesystem/transaction/command dependencies safely.

## Answer to Blocked (Architect) — use a workspace port (exact design)

Scope extended: `modules/orchestration/workspace.ts` (new), `modules/orchestration/index.ts`, `apps/sidecar/src/container.ts` (orchestration wiring only).

1. **New file `workspace.ts`:**
```ts
export interface AttemptResult { readonly changedFiles: readonly string[]; readonly baseSha: string; readonly headSha: string; readonly evidence: readonly CommandRun[] }
export interface IOrchWorkspace {
  prepareAttempt(run: OrchRun, task: OrchTask, attempt: number): Promise<Result<Worktree>>;
  applyWorker(run: OrchRun, task: OrchTask, attempt: number, worktree: Worktree, output: CoderOutput, signal?: AbortSignal): Promise<Result<AttemptResult>>;
  diff(worktree: Worktree): Promise<Result<string>>;
}
export class OrchWorkspace implements IOrchWorkspace { constructor(deps: { projects: { get(id: ProjectId): Promise<Project | null> }; worktrees: WorktreeManager; apply: Omit<WorkerApplyDependencies, 'projectId'>; runner: IProcessRunner }) }
```
   - `prepareAttempt`: look up `project.workspaceRoot` by `run.projectId` (missing ⇒ `NOT_FOUND`); base SHA = `git rev-parse HEAD` in that root, cached per `run.id` (first call); call `worktrees.create(root, { runId: run.id, taskId: task.id, attempt, baseSha }, task.allowedPaths)`.
   - `applyWorker`: validate `output` with the existing CoderOutput Zod schema (`validation/pipeline.ts`), invalid ⇒ `VALIDATION`; then `applyWorkerOutput({ ...deps.apply, projectId: run.projectId }, worktree, run.id, task.id, attempt, task.allowedPaths, task.testCommands, output, signal)`.
   - `diff`: `git diff <worktree.baseSha>..HEAD` in `worktree.path` via `runner` (argument array), return stdout.
2. **engine.ts:** replace the optional deps from requirement 1 with `workspace?: IOrchWorkspace`. Requirements 2–5 stay the same but call `workspace.prepareAttempt / applyWorker / diff`.
3. **index.ts:** accept `workspace?: IOrchWorkspace` in `createOrchestrationModule` deps and pass it to the engine.
4. **container.ts:** build `new OrchWorkspace({ projects: <existing project repository>, worktrees: new WorktreeManager(<existing process runner>), apply: { runner, fileSystem, commands: <existing CommandRunner>, writer: <existing WriteTransactionService> }, runner })` and pass it as `workspace`. Use the instances the pipeline orchestrator already uses.
5. Tests stay as specified (`ORCH-005`, `ORCH-006 (unit)`, `REVIEW_INVALID`) using a fake `IOrchWorkspace`; add one unit test for `OrchWorkspace.prepareAttempt` base-SHA caching with a fake runner.

Then replace `## Blocked` with `## Result`.
