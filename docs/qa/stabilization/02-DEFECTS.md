# 02 — Defects (stabilization pass, 2026-10-20)

Severity per the [test strategy](../../TESTING.md) §6 (S1 crash/data loss/security · S2 major function · S3 minor · S4 cosmetic).
"Before" evidence: the new regression tests were copied into a detached worktree of the baseline commit
`95dd972` and run there; "after" evidence: the same tests on the fixed branch (`03-VERIFICATION.md`).

All code paths below are under `apps/sidecar/src/modules/orchestration/` unless stated otherwise.

---

## STAB-D01 — `src/**` refuses nested paths (P0-01) · S2 · fixed

**Reproduction.** `globMatches('src/**', 'src/ui/Button.tsx')` → `false`. A worker that creates
`src/ui/pages/App.tsx` under `allowedPaths: ['src/**']` fails with `PATH_DENIED` ("Worker output contains a path
outside the task allowance"); worker context omits every nested file.

**Root cause.** `worktrees.ts` (and a copy in `dag.ts`) built the regex with chained `replace` calls: `**` → `.*`,
then `*` → `[^/]*` also rewrote the `*` of `.*`, so `src/**` became `^src/.[^/]*$`. `**` alone became `^.[^/]*$`.
The bug failed closed (no path escaped), so it blocked work rather than leaking writes.

**Fix.**
- New single matcher `glob.ts` (`globToRegExp`, `globMatches`, `isSafeGlob`): segment-based translation; a trailing
  `**` matches one or more segments, an inner/leading `**` zero or more; `*`/`?` never cross `/`; regex
  metacharacters escaped. Any unsafe pattern or path (absolute, drive letter, UNC, backslash, `.`/`..`/empty
  segment, NUL) never matches. Case-sensitive on purpose (a differently cased path is refused).
- `worktrees.ts` (worker apply), `workspace.ts` (worker context) and `path-locks.ts` (overlap) use it; path locks
  compare case-insensitively (conservative on Windows). `dag.ts` validates plan paths with `isSafeGlob`; the dead,
  buggy `pathIsInsideWorkspace` was removed.
- Defence in depth unchanged and still active: `coderOutputSchema` path validation → glob allowance →
  `isForbidden` (`.git`, `node_modules`, `.itstudio`, now also checked in `applyWorkerOutput`) → write transaction
  `resolveSafe` with realpath containment (symlinks/junctions).
- Side fix: `applyWorkerOutput` no longer sends an empty operation list to the write transaction (which refuses
  it); a no-change worker gets its empty commit as the code comment always intended.

**Regression tests.** `glob.test.ts` (46 cases: nested positives, unrelated negatives, traversal/absolute/drive/UNC/
backslash/NUL/empty-segment paths, unsafe patterns, path-lock overlap and case);
`test/integration/orchestration-reliability.test.ts` → `P0-01 ORCH-006 …` (real Git worktree, real write
transaction: nested files committed; `..`, absolute, drive, backslash, `src/.git/...` and a **junction** to a folder
outside the workspace all refused, outside folder untouched) and `P0-01 a run whose worker writes nested src/** files
reaches the owner and merges them`.
Before: 12/46 glob cases failed; both integration cases failed (`Worker output contains a path outside the task
allowance`). After: all pass.

---

## STAB-D02 — Final supervisor review was not a gate (P0-02) · S1 · fixed

**Reproduction.** Supervisor returns `{ approveForOwner: false, … }`, an adapter error, a timeout or `{}` → run state
`awaiting_approval`. A run whose agents contain no supervisor reaches `awaiting_approval` without any final review.

**Root cause.** `engine.ts` called `invoke(…'supervisor', { kind: 'final-review' … })` and discarded the result; the
run outcome only looked at task states. The prompt asked for `{ summary, risks }` (no verdict at all), although
`docs/governance/MULTI_AGENT_ORCHESTRATION.md` defines `{ approveForOwner, summary, risks[] }`.

**Fix.**
- `prompts.ts`: `finalReviewSchema = strictObject({ approveForOwner: boolean, summary: non-empty string,
  risks: string[] })` with its own `final-review` prompt kind and instructions. Strict: a missing, mistyped or extra
  field (e.g. `verdict: 'reject'` next to `approveForOwner: true`) is invalid.
- `engine.ts` `finalReview()`: `AWAITING_APPROVAL` only if every task passed review, integration merged and
  validated, and the parsed review says `approveForOwner: true`. Otherwise `paused` with
  `FINAL_REVIEW_REJECTED` / `FINAL_REVIEW_INVALID` / `FINAL_REVIEW_FAILED` (adapter error, timeout, ack mismatch) /
  `FINAL_REVIEW_UNAVAILABLE` (no supervisor) / the budget reason; cancellation ends `cancelled`.
- Evidence kept: the final-review attempt stores the verdict (`pass`/`reject`, summary, risks as findings) and the
  integration validation command runs.
- Mock supervisor (tests, E2E fixture) answers `final-review` with an explicit approval.
- Owner approval stays mandatory: `orch.approve` is still the only path to the target-branch merge.

**Regression tests.** `final-review.test.ts` (14 cases: approve, reject, 6 malformed/contradictory/missing payloads,
adapter failure, timeout, foreign acknowledgement, cancellation during the final review, no supervisor, budget stop);
`prompts.test.ts` (final-review and conflict prompt kinds).
Before: 12/14 failed with `expected 'awaiting_approval' to be 'paused'` (cancellation and budget stop were already
correct). After: 14/14 pass.

**Existing tests updated** (they relied on the defect, not weakened): `engine.test.ts` fixtures now include a
supervisor whose final review approves; ORCH-014 expects the final review call; ORCH-008 counts reviewer calls only;
`prompts.test.ts` expects the new prompt kinds.

---

## STAB-D03 — Crash recovery and resume (P1-01) · S1 · fixed

**Reproduction** (real Git repo + real SQLite file; "crash" = the first engine is left hanging at a chosen point and
a second module instance opens the same database).
1. The restart sweep (`start()` without a run id) is never called by `container.ts` → after a real crash the run stays
   `running` forever; `orch.resume` refuses ("Run is not paused"), `orch.start` is a no-op.
2. Called by hand, the sweep leaves tasks in `running`/`in_review`; the scheduler only runs `queued` tasks → resume
   ends `paused` (`TASK_FAILURE`) without doing anything.
3. Attempts were only saved when they finished, so a crash left no attempt record, no worktree record and nothing for
   the sweep to mark `UNKNOWN`.
4. Attempt numbers (and worktree/branch names `<task>-<n>`) restarted at 1 in every engine session → `git worktree
   add -b` collided with the previous session's branch.
5. Task worktrees were an in-memory map: after any pause/resume or restart, completed tasks of the earlier session
   had no worktree and were **silently skipped** at integration — the owner would approve a merge without them.
6. An integration branch left by a crash made `git worktree add` fail → resume ended `failed` (terminal).
7. Two concurrent `orch.resume` calls both started an engine.

**Fix.**
- `recovery.ts` (pure): restart sweep (`interruptedTasks`, `interruptedAttempts`), `requeueUnfinished`, and
  `taskResume` — from the persisted attempts, a task's worktree, next attempt number, pending findings, whether its
  last worker attempt still needs review, or already passed it.
- `engine.run(run, onChange, history)`: completed tasks keep their result and worktree; every other task is queued
  with new attempt ids; a finished but unreviewed worker attempt is reviewed instead of redone; numbering continues
  after the persisted attempts; integration and any earlier pause reason are rebuilt each session; a completed task
  without a source worktree pauses the run (`INTEGRATION_SOURCE_MISSING`) instead of being dropped.
- Every attempt is persisted as `running` **before** a worktree is created or an agent is called, and again with
  its worktree path; the sweep turns it into `UNKNOWN`.
- `OrchRun.baseSha` (new optional field) persists the task base so resumed attempts use the same base.
- `WorktreeManager.createIntegration` removes a stale integration worktree/branch of the run first;
  `listRun` + `IOrchWorkspace.runWorktrees` let cleanup find worktrees a crashed engine created but never recorded.
- `orchestration-module.ts`: `recoverInterrupted()` (also skips runs active in this process), called by
  `container.ts` at startup **before** the RPC transport starts; nothing is relaunched automatically. `launch()`
  serializes engine sessions per run (registered synchronously); resume/approve/discard refuse a busy run; an engine
  exception leaves the run `paused_interrupted` (`ENGINE_ERROR`) instead of stuck `running`.
- Costs: attempts are upserted by id and the run cost is the persisted total plus this session's attempts, so a
  resumed run never counts an attempt twice; an interrupted attempt's cost stays unknown (`null`), never 0.

**Regression tests.** `recovery.test.ts` (6) and `orchestration-reliability.test.ts` → `P1-01 …` (9): crash before
worker execution, during worker execution, during file application, after the worker's commit but before its result
was saved, during review, during integration/final review, while awaiting approval, repeated + concurrent resume
requests, double sweep. Each checks: `paused_interrupted`, task `queued`, attempt `unknown`, no agent call by the
sweep, resume with a new attempt id, no duplicate attempt rows, run cost = sum of attempt costs, only the resumed
attempt's change merged, exactly one merge commit, all run worktrees and branches removed after approval.
Before (baseline + legacy `start()` sweep): 7/8 failed (`expected 'running' to be 'queued'`; crash during review →
`paused`; crash during integration → `failed`; concurrent resumes `[true, true]`); only "awaiting approval" passed.
After: all pass.

**Known limitation.** An attempt whose agent call finished but whose result was not saved (crash in between) is
retried — the real provider cost of the lost call is in the ledger but not in the run's cost total (it was never
reported back). Resuming is always an explicit owner action.

---

## STAB-D04 — Integration conflicts "resolved" by text (P1-02) · S1 · fixed

**Reproduction.** Two tasks change the same line of `src/shared.ts` from the same base. Merging the second task into
the integration worktree conflicts; the reviewer answers `{ verdict: 'pass' }`; the engine continues. Result: run
`awaiting_approval`, `git ls-files -u` in the integration worktree still lists the conflicted file, `MERGE_HEAD`
exists, and the second task's change is not in the integration commit the owner would merge.

**Root cause.** `engine.ts` treated `verdict === 'pass'` of a read-only reviewer as proof of resolution; `mergeTask`
never aborted, never checked unmerged entries and never committed a resolution. Non-conflict merge failures were
treated as conflicts.

**Fix** (no write access for the reviewer):
- `IOrchWorkspace.mergeTask(…, resolve?)`: on a content conflict it lists unmerged paths, reads their content
  (text, ≤ 256 KiB, contained via `resolveSafe`) and calls the engine's resolver. The reviewer (read-only, run in the
  integration worktree) returns `{ resolutions: [{ path, content }], summary }` (`conflictResolutionSchema`). The
  workspace accepts it only for **exactly** the conflicted files and only without conflict markers, writes it through
  the journaled write transaction with base hashes, `git add`s those paths, requires zero unmerged entries, commits
  the merge and checks `MERGE_HEAD` is gone. Anything else → `git merge --abort`, conflict reported unresolved with a
  reason (`CONFLICT_RESOLUTION_SCOPE`, `CONFLICT_MARKERS_LEFT`, `CONFLICT_UNSUPPORTED`, …).
- Engine: unresolved → run `paused` `INTEGRATION_CONFLICT`, the reviewer attempt records the conflicted files and the
  refusal reason; a non-conflict merge error → `INTEGRATION_FAILED`. Validation commands always run after all merges
  (once per distinct command); the final review and owner approval follow as before.

**Regression tests.** `orchestration-reliability.test.ts` → `P1-02 …` (4): a real conflict resolved through the
engine (conflict markers delivered to the reviewer, no unmerged entry, no `MERGE_HEAD`, validation evidence
recorded, combined content in the target after approval); escalation for a textual `pass`, for content with
markers, for an extra file outside the conflicted set (integration HEAD and index clean, target untouched, approval
refused).
Before: 4/4 failed (textual pass reached `awaiting_approval`; unmerged entries left). After: all pass.

---

## STAB-D05 — Approval could merge something other than what was reviewed (P1-03) · S1 · fixed

**Reproduction.**
1. Run reaches `awaiting_approval`; the owner commits to `main`; `orch.approve` → merges anyway (the merged result
   was never validated or reviewed).
2. A merge that fails after starting (e.g. a failing `pre-merge-commit` hook) leaves `MERGE_HEAD` and a half-merged
   index in the owner's project.
3. Two concurrent approvals both run the merge path; completion was saved only after cleanup, so a cleanup exception
   left a merged run in `awaiting_approval` (approvable again).

**Fix.**
- The run records `integrationBaseSha` (target tip the integration branch was built on — integration is now always
  built on the target branch as it is at integration time) and `integrationHeadSha` (the commit that passed
  validation and the final review).
- `orch.approve` (`checkApproval`): target branch checked out; no merge in progress; `HEAD` = `integrationBaseSha`;
  integration branch tip = `integrationHeadSha`; no uncommitted change in any file the merge changes (from the actual
  diff, not from worker attempt lists). A changed target or integration branch, or a run without a reviewed commit,
  makes the approval **stale**: the run moves to `paused` (`TARGET_CHANGED` / `INTEGRATION_CHANGED` /
  `REVIEW_STALE`) and a resume rebuilds integration on the new tip, re-validates and asks for a new final review.
  (`run-machine.ts`: `awaiting_approval → paused` added.)
- The merge uses the reviewed SHA, not the branch name; on failure it aborts any merge in progress; after success it
  verifies `HEAD^1 = integrationBaseSha` and `HEAD^2 = integrationHeadSha`.
- Approvals are serialized per run (and against resume/discard/active engine); `completed` is saved immediately after
  the merge, then cleanup runs; a cleanup failure is recorded as `stateReason: CLEANUP_INCOMPLETE` and never undoes
  or repeats the merge. Discarding a completed run is refused.

**Regression tests.** `orchestration-reliability.test.ts` → `P1-03 …` (6): unchanged target merges exactly the
reviewed commit (parents and tree checked); target advanced → refused, run `paused TARGET_CHANGED`, resume →
re-integrated on the new tip → approve contains both; dirty file touched by the merge → refused, owner change kept;
concurrent approvals → one merge; merge failure → target and working tree untouched, no `MERGE_HEAD`; cleanup failure
→ `completed` + `CLEANUP_INCOMPLETE`, repeated approval refused, still one merge.
Before: 4/6 failed (stale approval merged; `MERGE_HEAD` left behind; no `integrationHeadSha`; no
`CLEANUP_INCOMPLETE`); the dirty-file and concurrency cases happened to pass at baseline. After: all pass.

---

## STAB-D08 — Project roots compared as strings (8.3 short names, junctions) · S2 · fixed

**Found by** the first CI run (`39451656683`): the runner's `TEMP` is `C:\Users\RUNNER~1\AppData\Local\Temp`, while
Git prints real long paths (`C:/Users/runneradmin/...`). Reproduced locally by pointing `TEMP` at an 8.3 short name
(`…\Temp\ITE13B~1`) and, deterministically, by opening a project through a **junction**.

**Impact.** (a) Orchestration refused valid projects ("…is inside the Git repository…", "The project root must be
the Git repository root"); `OrchWorkspace.projectInfo` unit tests already failed at baseline under such a `TEMP`.
(b) Knowledge `discoverFiles` compared the root as given with file real paths and **silently indexed nothing**
(ingest "succeeds" with 0 documents) — CI cases BRK-C09, BRK-S06, BRK-D03, TC-M3-037. (c) Accepting junctions
without care would have let a junction to IT Studio's own repository bypass `TARGET_FORBIDDEN` (string check).

**Fix.** `canonicalPath()` (native `realpath`) in `worktrees.ts`: repository-root checks, worktree paths, cleanup and
run-worktree listing use real paths; `OrchWorkspace.targetForbidden` checks the given and the real path.
`discoverFiles` compares against the root's real path and still skips links inside the workspace (a file's real
path must equal the root's real path plus its own relative path); an unreadable root now reports an error.

**Regression tests.** `workspace.test.ts` → `CI-01 …` (project through a junction works; a junction to IT Studio is
`TARGET_FORBIDDEN`), `discover-files.test.ts` → `CI-02 …` (real file system: junction root indexed, junction inside
the project not followed). Before: 3/3 failed on `95dd972`. After: pass; the orchestration unit (105) and
integration (23) tests also pass with an 8.3 `TEMP`. `TC-M5-033` now injects its `readdir` failure at call 4 (one
more `realpath` call precedes it) — same assertion.

---

## STAB-D06 — No CI, unprotected `main` · S3 · see `05-CI-GOVERNANCE.md`

## STAB-D07 — Stale documentation · S4 · see `06-FINAL-REPORT.md` (documentation section)

---

## Observations not fixed in this pass (out of scope or needs an owner decision)

| ID | Observation | Why not fixed |
|---|---|---|
| OBS-01 | A dependent task's worktree starts from the run base, not from its dependency's result, so task B cannot build on task A's code; conflicts are only found at integration. | Changes how plans execute (feature-level behaviour of D41); needs an owner/architecture decision. |
| OBS-02 | Integration validation evidence is stored only on the final-review attempt; a failed integration validation pauses the run with a reason but no attempt carries the command output. | Needs a contract change (run-level evidence) — follow-up. |
| OBS-03 | The Code → Orchestration view showed Discard only in `awaiting_approval`; a paused run (e.g. `FINAL_REVIEW_REJECTED`, `INTEGRATION_CONFLICT`) could be resumed but not discarded. | **Fixed** in STAB-02 (`OrchestrationCodeView.tsx` + test cases for `paused`, `paused_interrupted`). |
| OBS-04 | GitHub Actions were pinned to major tags (`@v5`), not to commit SHAs. | **Fixed** 2026-10-21: pinned to the commit SHAs `@v5` resolved to (`05-CI-GOVERNANCE.md` §2). |
