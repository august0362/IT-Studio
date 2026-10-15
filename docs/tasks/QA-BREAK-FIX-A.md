# QA-BREAK-FIX-A — Sidecar defects found by the adversarial suites

Milestone: v1 hardening · Role: Implementer (ROLES §1.3) · Size M · **Deps pre-installed** · Depends on QA-BREAK-01/02, UX-02 (landed)

## Goal

Turn every sidecar `it.fails('QA-BREAK-0x-Dnn …')` in `apps/sidecar/test/integration/break-*.test.ts` into a passing `it(...)` by fixing the product. Desktop defects are in QA-BREAK-FIX-B.

## Read first

`AGENTS.md`, `../CONTEXT.md` D4, D7, D10, D11, D32, the defect tables in `docs/tasks/QA-BREAK-01.md` and `docs/tasks/QA-BREAK-02.md`, the failing tests themselves.

## Scope — files you may create/modify

- `apps/sidecar/src/**` (product fixes + unit tests). No SQL migration unless unavoidable (then justify in Result).
- `apps/sidecar/test/integration/break-*.test.ts` — only `it.fails` → `it` for fixed defects and the D01 rewrite below; do not weaken assertions.
- `src/types/schemas.ts` — **only** remove `workspace.readFile` and `workspace.runCommand` from the RPC map (Architect decision below).
- This task file (`## Result`)

## Defects

| ID | Fix |
|---|---|
| QA-BREAK-01-D01 | **Architect decision:** `workspace.readFile` / `workspace.runCommand` are unused by any client. Remove them from `RpcMethodMap` and from `validation/ipc.ts` (params + result). Rewrite the D01 test: both methods return `-32601` and are absent from the contract. |
| QA-BREAK-01-D02 | `pnl.get` errors after adversarial money inputs: unsafe money must be rejected at `revenue.add`/related inputs (finite, safe integer µUSD/VND, non-negative where required) and `pnl.get` must always return finite integer totals. |
| QA-BREAK-01-D04 | RPC params validation must reject unknown keys (`.strict()` on every top-level params object in `validation/ipc.ts`, and nested patch objects such as `SettingsPatch`), never touch `Object.prototype` (`__proto__`, `constructor`, `prototype` keys rejected). Check that the desktop never sends extra keys (run desktop tests). |
| QA-BREAK-02-D05 | Deleting a RAG source during an in-flight (re-)index must win: the ingest job checks a per-source generation/cancel token before every write (metadata and vectors) and drops its results if the source was deleted; no resurrected document or vectors. |
| QA-BREAK-02-D06 | Two same-tick `pipeline.start` for one project: admission must be atomic (synchronous check-and-reserve before any `await`). Exactly one active run; the other request follows the existing queue/reject contract consistently — keep whatever the current contract says for a busy project. |
| QA-BREAK-02-D07 | During a 500-query `rag.query` burst ping p95 must be < 200 ms: workflow activity recording/broadcast must not block the event loop (batch/coalesce activity events, e.g. flush at most every 100 ms, bounded queue). |
| QA-BREAK-02-D09 | **Found in UX-02 QA (S2):** after a crash during WRITING, startup journal recovery (`container.ts` startup block) restores the files and publishes a `pipeline.failureReport` **without `runId`**, but never updates the run row — the run stays `writing` forever, so the project's queue gate (PSTUDIO-01 hydration) blocks every later `pipeline.start`. Fix: at startup, for every non-terminal run that is not `clarifying`, mark it `rolled_back` when its transaction was recovered (else `failed`), set `finishedAt`, attach a failure report with its `runId`, persist, publish `pipeline.event` `finished` + the report; release its queue gate. `clarifying` runs stay waiting. `break-durability.test.ts` BRK-D02 (both crash points) must pass; add a unit test for the startup sweep. |
| QA-BREAK-02-D08 | Concurrent `settings.update` patches lose fields: serialize updates (single-flight mutex / queue) and apply each patch to the latest persisted state (read-modify-write inside the lock). |

## Flaky test

| ID | Fix |
|---|---|
| FLAKE-3 | `apps/sidecar/src/container.test.ts` "logs lifecycle events in order and creates the daily log file" fails under full-suite load (missing last lifecycle lines, then `EPERM` removing the temp dir); passes alone. Await the log flush deterministically (wait for the expected lines with a bounded poll instead of a fixed delay) and retry temp-dir removal (`fs.rm` with `maxRetries`). |

## Acceptance criteria

- [ ] All eight defects fixed; their tests are plain `it(...)` and pass; no other break or integration test regresses.
- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass. QA runs `npx vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/` outside the sandbox.

## Hand-back

Append `## Result` per AGENTS.md §3.

## Result

- Summary: Implemented all eight sidecar defect fixes and FLAKE-3. Removed the unused workspace RPC contracts; hardened RPC and money validation; serialized settings updates and pipeline admission; made deletion cancel active/queued RAG replacements; deferred and bounded workflow persistence/broadcast; and persisted terminal run recovery with correlated failure reports. Converted every sidecar break-suite expected failure to a plain test without weakening its assertions (D01 rewritten as directed).
- Files changed: `apps/sidecar/src/container.test.ts`, `apps/sidecar/src/container.ts`, `apps/sidecar/src/infra/sqlite/activity-repository.ts`, `apps/sidecar/src/services/activity-recorder.test.ts`, `apps/sidecar/src/services/activity-recorder.ts`, `apps/sidecar/src/services/journal-recovery.ts`, `apps/sidecar/src/services/pipeline-orchestrator.test.ts`, `apps/sidecar/src/services/pipeline-orchestrator.ts`, `apps/sidecar/src/services/pipeline-recovery.test.ts`, `apps/sidecar/src/services/pipeline-recovery.ts`, `apps/sidecar/src/services/pnl-service.test.ts`, `apps/sidecar/src/services/pnl-service.ts`, `apps/sidecar/src/services/rag/rag-deletion.test.ts`, `apps/sidecar/src/services/rag/rag-service.ts`, `apps/sidecar/src/services/revenue-service.test.ts`, `apps/sidecar/src/services/revenue-service.ts`, `apps/sidecar/src/services/settings-service.test.ts`, `apps/sidecar/src/services/settings-service.ts`, `apps/sidecar/src/validation/cost.ts`, `apps/sidecar/src/validation/ipc.test.ts`, `apps/sidecar/src/validation/ipc.ts`, `apps/sidecar/src/validation/pipeline.ts`, `apps/sidecar/src/validation/rag.ts`, `apps/sidecar/src/validation/router.ts`, `apps/sidecar/src/validation/settings.ts`, `apps/sidecar/src/validation/worker.ts`, `apps/sidecar/test/integration/break-concurrency.test.ts`, `apps/sidecar/test/integration/break-protocol.test.ts`, `apps/sidecar/test/integration/break-security.test.ts`, `apps/sidecar/test/integration/break-validation.test.ts`, `docs/tasks/QA-BREAK-FIX-A.md`, `src/types/schemas.ts`.
- Dependencies added (with reason): None. Restored the existing dependencies with `npm.cmd --cache .npm-cache install` because node_modules was absent; manifests and the lockfile are unchanged. No migrations.
- Decisions taken within scope: Used Zod strict objects for all RPC parameter objects and their nested settings/config objects, while preserving existing model-output parsing. Retained established USD rounding to integer micro-USD, rejected fractional/unsafe VND and aggregate revenue overflow, and applied the existing 10,000?100,000 FX bounds to settings patches. Empty P&L ranges return zero totals; reversed ranges remain invalid. Overlapping admissions for one project return CONFLICT synchronously; subsequent requests retain the existing same-project queue contract (TC-M6-050 and clarification gates). RAG jobs snapshot per-source generations when requested and check them before each write; source write locks let deletion clean up an already-started write. Workflow persistence drains at most 64 events per 100 ms from a 2,000-event queue; per-project broadcast queues retain at most 500 events and the existing 250 ms cadence. Startup recovery matches recovered transaction IDs, including a WRITING run interrupted before prepare returned its ID, marks other interrupted runs failed, leaves clarifying runs unchanged, and gates pipeline RPC access until the sweep finishes.
- Open issues / follow-ups: QA must run the full integration suite outside the sandbox: `npm --cache .npm-cache exec -- vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/`. The attempted five break files all stopped before startup because tsx calls os.userInfo() and Windows returned uv_os_get_passwd ENOMEM (ENV-1); consequently the process-level BRK-D02 crash points and BRK-C12 ping p95 still need supported-runtime confirmation. `npm --cache .npm-cache test` stops in pretest because four secret-scanner self-tests require empty stderr but sandbox Git emits a permission warning for the global ignore file. Tooling was left unchanged. Full concurrent Vitest runs also showed intermittent failures in existing desktop ChatPage workflow deep-link, WorkflowPage retrieval status, and PipelineStudioPage initial-render tests; final verification is recorded below.
- Changelog draft for the Architect: Fix sidecar validation, concurrent mutation races, interrupted pipeline recovery, and workflow burst responsiveness (QA-BREAK-FIX-A).

- Verification: Prettier was run on every changed file (Markdown and the canonical schemas file are ignored by repository configuration). Full Vitest with `npm --cache .npm-cache exec -- vitest run --project sidecar --project desktop --project vscode-ext --maxWorkers 1` passed: 157 files passed, 1 skipped; 1,269 tests passed, 4 existing desktop expected failures, 1 skipped. The three intermittently failing desktop files passed in that complete run. Direct build/release tests passed 17/17. No test assertions, timeouts, or tool configurations were relaxed. Final typecheck/lint outcomes follow below.
- Final checks: `npm --cache .npm-cache run typecheck` passed for all workspaces and integration/E2E test types. `npm --cache .npm-cache run lint` passed, including repository-wide Prettier checking and secret scanning (Git still prints the harmless global-ignore permission warning). `git diff --check` passed. No commits were made.

## QA round 1 (Architect, 2026-10-15) — test-only fixes, then update `## Result`

Unit: 1 277 pass. Integration: 159 pass, 3 fail. Triage:

1. **BRK-C01 / D06 — wrong expectation (test defect).** The product contract is a per-project **queue** (`pipeline-orchestrator.ts` `tails`): a second `pipeline.start` for a busy project is **accepted and queued**, then runs after the first. Rewrite the test (keep the `QA-BREAK-02-D06` name prefix, rename the rest to "queues the second same-tick pipeline start and never runs both at once"): both responses succeed with distinct run ids; capture `pipeline.event` notifications; wait until both runs are terminal; assert every `stage` event of the second run comes **after** the first run's `finished` event (no interleaving), and both runs end `completed` (or both terminal with valid stages).
2. **BRK-D02 `mid_commit` — scenario never reaches the crash point (test defect).** With a single created file, the `mid_commit` crash hook never fires (see `pipeline.test.ts` TC-M6-031, which uses two files for `mid_commit`). For `mid_commit` make the scripted coder output create **two** files; keep `after_prepare` as is. Assertions unchanged.
3. BRK-V03 passed when re-run alone (cold-start timeout) — no change.

Scope: `apps/sidecar/test/integration/break-concurrency.test.ts`, `apps/sidecar/test/integration/break-durability.test.ts`, `break-helpers-02.ts` if needed. No product changes.

## Result

- Summary: Applied only the two QA round 1 integration test edits. BRK-C01 now requires two successful starts with distinct run IDs, schema-valid notifications, exactly one finished event per run, terminal persisted runs, and every second-run stage event after the first run finishes. BRK-D02 now supplies two allowed create operations for `mid_commit`; `after_prepare` and all recovery assertions are unchanged. BRK-C01 has the contract conflict documented below and is not verified passing.
- Files changed: `apps/sidecar/test/integration/break-concurrency.test.ts`, `apps/sidecar/test/integration/break-durability.test.ts`, `docs/tasks/QA-BREAK-FIX-A.md`. Preserved the Architect's existing QA round 1 instructions.
- Dependencies added (with reason): None; `node_modules` was present.
- Decisions taken within scope: Retained the existing pipeline fixture and allowed valid terminal outcomes as QA requested; the repeated create can fail on the second run because the first run already created `note.txt`. No product, helper, configuration, or unrelated test changes. No commits.
- Verification: Ran Prettier on both changed test files before checks. `npm.cmd --cache .npm-cache run typecheck` passed, including integration test types. `git diff --check` passed. Targeted BRK-C01 and both BRK-D02 scenarios were attempted but all failed before `system.ready` because tsx calls `os.userInfo()` and the Windows sandbox returns `uv_os_get_passwd ENOMEM` (ENV-1). `npm.cmd --cache .npm-cache test` stopped in pretest: four secret-scanner self-tests expect empty stderr but Git prints a permission warning for `C:\Users\admin/.config/git/ignore`. Used `npm.cmd --cache .npm-cache` because PowerShell blocks `npm.ps1`.
- Open issues / follow-ups: QA must rerun the targeted integrations outside the sandbox. The BRK-C01 ordering requirement also needs the Architect decision below before this round can be considered complete. `npm.cmd --cache .npm-cache run lint` passed, including Prettier and secret scanning; Git printed the same global-ignore permission warning.

## Blocked

- BRK-C01 requirement conflict: QA round 1 requires **every** stage event of the second run to follow the first run's finished event. Existing `apps/sidecar/src/services/pipeline-orchestrator.ts:182` calls `this.publishStage(run)` during admission, immediately before reading the project's queue tail at line 183. Thus an accepted queued run announces its initial `specifying` stage before its execution turn; the requested assertion can fail even when execution is serialized correctly.
- Tried: Implemented the exact requested event ordering assertion, checked the queue implementation and TC-M6-050, and attempted the targeted integrations (blocked at process startup by ENV-1). Typecheck passes. Left the strict assertion in place for review rather than silently excluding admission notifications or changing product code outside scope.
- Precise Architect question: Should BRK-C01 explicitly exclude the initial admission notification when checking execution ordering, or should a separate product task defer that notification until execution begins? AGENTS.md section 4 requires stopping and documenting this blocker; QA round 1 expressly forbids product changes.

## QA round 2 (Architect, 2026-10-15)

D02 fixed (both crash points pass). D06 still fails: `pipeline-orchestrator.ts` `start()` calls `publishStage(run)` once at creation (stage `specifying`) **before** the run waits on the project's `tails` queue — that creation event is part of the existing contract, not execution. Execution is serialized correctly. Adjust the D06 assertion only: ignore the **first** `stage` event of the second run (its creation event); every later `stage` event of the second run must come after the first run's `finished` event. No product change.

## Result

- Summary: Applied only QA round 2: BRK-C01 skips the second run's first stage notification when checking execution ordering; every later stage notification must follow the first run's finished event.
- Files changed: `apps/sidecar/test/integration/break-concurrency.test.ts`, `docs/tasks/QA-BREAK-FIX-A.md`. Preserved pre-existing QA round 1 edits, including `break-durability.test.ts`.
- Dependencies added (with reason): None; `node_modules` was present.
- Decisions taken within scope: Filter stage events for the second run while retaining their original notification indices, then skip exactly the first matching event. All other assertions and product code are unchanged. No commits.
- Verification: Ran Prettier on both changed files (the task Markdown is ignored by repository configuration). `npm.cmd --cache .npm-cache run typecheck`, `npm.cmd --cache .npm-cache run lint`, and `git diff --check` passed. Lint emitted the existing Git global-ignore permission warning. Used `npm.cmd` because PowerShell blocks `npm.ps1`.
- Open issues / follow-ups: Targeted D06 integration execution failed before `system.ready` because tsx calls `os.userInfo()` and the Windows sandbox returns `uv_os_get_passwd ENOMEM` (ENV-1). QA must rerun it outside the sandbox. `npm.cmd --cache .npm-cache test` stopped in pretest: four secret-scanner self-tests require empty stderr but Git prints a permission warning for `C:\Users\admin/.config/git/ignore`.
