# 01 — Baseline (stabilization pass, 2026-10-20)

Scope of the pass: reliability, verification and release hardening of the existing v1 + ORCH feature set. No new
features (LLMPOOL, PROC-03, v2, v3 stay out of scope).

## Repository state at the start

| Item | Value |
|---|---|
| Baseline commit | `95dd972` — `refactor(sidecar): module factories, rpc.ts per module, slim composition root [MOD-02]` |
| Branch | `main`, up to date with `origin/main`; working tree clean |
| Worktrees | only the main checkout (no active Codex/agent jobs) |
| Other branches | local `task/PSTUDIO-02` (`542b27b`, already merged history), remote `task/M9-FIX2` (`de02a48`) — left untouched |
| Stabilization branch | `stabilization/v1-hardening`, created from `95dd972` |
| GitHub | `august0362/IT-Studio`, public; **no `.github/` directory** (no CI); `main` **not protected** (`GET /repos/.../branches/main` → `"protected": false`, checked 2026-10-20 without authentication) |
| Toolchain | Node 24.19.0, npm 11.17.0, Git 2.54.0.windows.1, TypeScript 6.0.x (ADR-0002), Windows 11 |
| `gh` CLI | 2.102.0, **not logged in** |

## Baseline test status (commit `95dd972`, this machine, no other job running)

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` | 0 | pass (55 s) |
| `npm run lint` (ESLint, Prettier, secret scan) | 0 | pass (3 min) |
| `npm test` | 0 | vitest 184 files: **1 678 passed, 1 skipped** (keychain test, needs a real OS keychain); node script tests 27/27 |
| `npm run test:integration` | 1 (stopped) | stopped after 2 of 25 files to unblock the work: `break-concurrency.test.ts` 2 failed (BRK-C01, BRK-C12, both ~9 s timeouts), `chat.test.ts` 1 failed (TC-M2-010 timeout). Each file took ~2 min. These are the timing-sensitive cases already listed as flaky under load in `docs/qa/V1-report.md` / HANDOFF. |
| `vitest … orchestration.test.ts` (integration, alone) | 0 | 3/3 passed |

Logs were kept outside the repository (session scratch directory); the numbers above are copied from them.

## Architecture affected

All defects found are in the orchestration module (`apps/sidecar/src/modules/orchestration/`, D41 / ADR-0006):

- `worktrees.ts` / `dag.ts` / `path-locks.ts` / `workspace.ts` — allowed-path globs, worker file application,
  worktree and integration branch lifecycle.
- `engine.ts` — task pipeline, integration, final supervisor review, run outcome.
- `orchestration-module.ts` — RPC handlers (`orch.start/resume/approve/discard`), restart sweep.
- `container.ts` — startup sequence (the restart sweep was never called).
- `src/types/schemas.ts` — `OrchRun` (additive optional fields only).

Pipeline (D5/D11), router, ledger, RAG, UI and packaging code were not changed.

## Initial findings (confirmed by reproduction, details in `02-DEFECTS.md`)

| ID | Severity | Finding |
|---|---|---|
| STAB-D01 (P0-01) | S2 | `globMatches("src/**", …)` compiles to `^src/.[^/]*$`: every nested path under an allowed directory is refused, so real workers cannot write `src/ui/Button.tsx`; same bug in `dag.ts` (dead `pathIsInsideWorkspace`). |
| STAB-D02 (P0-02) | S1 | The final supervisor review result is ignored: a rejecting, failing, timed-out or malformed review still moves the run to `AWAITING_APPROVAL`; a run without a supervisor skips the review. |
| STAB-D03 (P1-01) | S1 | Crash recovery is broken end to end: the restart sweep is never called at startup, interrupted tasks stay `running` and are never rescheduled, running attempts were never persisted, attempt/worktree numbers are reused, completed tasks of an earlier session are silently dropped from integration, an existing integration branch makes resume fail, and concurrent resumes start two engines. |
| STAB-D04 (P1-02) | S1 | A Git merge conflict is "resolved" by a reviewer's textual `pass`: the merge is left half-done with unmerged entries, the conflicting task's change is not in the integration commit, and the run still reaches the owner. |
| STAB-D05 (P1-03) | S1 | Approval merges the integration *branch name* without checking that the target branch is still the commit the review was built on, leaves a failed merge (`MERGE_HEAD`) in the owner's working tree, has no protection against concurrent approvals, and records completion only after cleanup. |
| STAB-D06 | S3 | No CI on GitHub and `main` is unprotected. |
| STAB-D07 | S4 | `docs/HANDOFF.md` (2026-10-14), test counts and several dates are stale. |
