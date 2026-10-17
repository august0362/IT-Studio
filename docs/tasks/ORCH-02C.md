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

## Result
- Summary: Added the orchestration workspace port and concrete project/worktree/apply integration. Worker attempts now receive isolated worktrees, apply validated output through the existing transactional worker path, and record changes and validation evidence. Reviewer inputs include the committed diff; invalid reviewer verdicts fail the review and consume fix rounds until escalation.
- Files changed: `apps/sidecar/src/modules/orchestration/engine.ts`, `engine.test.ts`, `workspace.ts`, `index.ts`, `worktrees.ts`, `apps/sidecar/src/container.ts`, and this task file.
- Dependencies added (with reason): None.
- Decisions taken within scope: Reused the pipeline command runner, write transaction service, file system, and process runner in container wiring. Worker validation command failures now return `COMMAND_FAILED` so an unsuccessful test cannot count as a successful apply. Base SHA is cached per run as specified.
- Open issues / follow-ups: None.
- Verification: `npm --cache .npm-cache run typecheck`, `npm --cache .npm-cache run lint`, and `npx --cache .npm-cache vitest run --project sidecar apps/sidecar/src/modules/orchestration` passed (11 tests). The first `npx` invocation was blocked by PowerShell execution policy; the equivalent `npx.cmd` formatter invocation succeeded.