# QA-E2E-FIX4 — Stabilize the remaining v1 GUI regression cases

Milestone: v1 quality follow-up · Role assignment: Architect (this work order), Implementer (E2E harness and scoped specs after owner decision), QA/Reviewer (TESTING.md §7–8 gate)

## Goal

Make the remaining M4–M6 L4 GUI cases independently repeatable so the later milestone regression gate can distinguish product failures from shared-session setup failures.

## Read first

- `AGENTS.md`, `CONTEXT.md`, `CONVENTIONS.md` §10, `TESTING.md` §§5–8, `docs/HANDOFF.md` §5.
- `docs/qa/M4-report.md`, `docs/qa/M5-report.md`, `docs/qa/M6-report.md`, and the matching milestone test-case documents.
- `e2e/run-e2e.mjs`, `e2e/wdio.conf.ts`, and the affected `e2e/specs/m4`, `m5`, and `m6` files.

## Scope — files you may create/modify

- `e2e/wdio.conf.ts` (harness isolation, driver lifecycle, failure hooks).
- `e2e/helpers/diagnostics.ts` (new, if useful for DOM/screenshot capture).
- `e2e/helpers/ui.ts` (shared GUI setup/waits only if necessary).
- `e2e/specs/m4/scripted-llm.spec.ts`, `e2e/specs/m4/cost.spec.ts`, `e2e/specs/m4/settings.spec.ts`.
- `e2e/specs/m5/knowledge.spec.ts`, `e2e/specs/m6/code.spec.ts`.
- `e2e/specs/mw/workflow.spec.ts` (register its remote driver for failure evidence; keep existing Workflow assertions).
- `scripts/dev/measure-startup.mjs` and `scripts/dev/measure-startup.test.mjs` (startup measurement fix and focused regression).
- This task file for `## Result` / `## Blocked`; `docs/reports/QA-E2E-FIX4-blocked.md` for the Architect decision record.

Harness work (`wdio.conf.ts`, diagnostics) and affected spec work have disjoint source paths. Implement in that order because the specs depend on the new lifecycle; do not let two agents edit the task or report file at once.

## Contracts

- Preserve existing JSON-RPC and `src/types/schemas.ts` shapes. Use the scripted E2E provider and isolated test data; no real provider network or keychain access.
- Every automated case keeps its existing `TC-Mx-###` identifier. The runner must surface a failure with useful DOM/screenshot evidence.

## Requirements

1. Isolate app and data state per spec by restarting its tauri-driver session with a fresh `ITSTUDIO_DATA_DIR` and WebView2 user-data folder. Preserve pre-existing app processes and owner data. Keep scripted provider fixtures and dedicated ports working.
2. Capture a dated DOM snapshot and screenshot for each failed case in a dedicated OS temp evidence directory and print the evidence paths. Never retain fake API keys in report text.
   Include both `TC-Mx-###` and `TC-MW-###` identifiers in evidence file names when a case has one.
3. Fix only E2E setup, ordering, assertions, and waits needed for the recorded cases; keep their behavior assertions meaningful. Rerun affected specs before the milestone regression.
4. Preserve P1/P2 traceability and report any skipped case honestly; do not mark a milestone QA gate passed while TESTING.md §7 exit criteria fail.
5. Keep the sidecar stdin pipe open while `measure-startup.mjs` waits for Ready, then close the child cleanly. Verify this with a focused regression; this follow-up is explicitly listed under QA-E2E-FIX4 in ROADMAP.md.

## Acceptance criteria (verifiable)

- [x] The owner authorized a new, distinct E2E harness approach after the six-attempt stop (2026-10-11, option A).
- [ ] A fresh app/data state is observed for each spec; a forced failure writes both DOM and screenshot evidence without touching owner data.
- [ ] Each affected case has a repeatable L4 verdict; all required `typecheck`, `lint`, `test`, and E2E gates pass.
- [ ] A QA report records the L4 evidence and TESTING.md §7 impact.
- [ ] `node scripts/dev/measure-startup.mjs` completes five measurements without the sidecar exiting on stdin EOF before Ready.

## Out of scope

- Product behavior changes, contract changes, toolchain changes, and weakened test assertions.

## Blocked

- Question: May QA reopen these GUI cases with the distinct per-spec isolated-session and failure-capture approach, or should the v1 hand-over remain conditional with the M9 full L4 regression gate open?
- What was tried: Prior QA reports and `docs/HANDOFF.md` record six fix attempts. The M4–M6 behaviors pass at L2/L3; the unresolved L4 runs are flaky or state-dependent. The recorded list contains 15 case IDs even though HANDOFF calls it 13; the report preserves the exact IDs rather than silently reconciling the count. See `docs/reports/QA-E2E-FIX4-blocked.md`.

## Decision and role assignment (2026-10-11)

- Admin chose option A: reopen with per-spec isolated app/data sessions and failure evidence.
- Architect: this scoped work order and the six-attempt record.
- Implementer: harness first, then the affected M4–M6 spec setup in the disjoint files above; no application code or contracts.
- Implementer (startup subtask): repair only `scripts/dev/measure-startup.mjs` and its focused test; this source scope is disjoint from the E2E harness/spec files.
- QA/Reviewer: review CONVENTIONS.md §10 and TESTING.md, run Prettier then typecheck/lint/test, execute the affected L4 specs and full regression once, and report exact case verdicts. Stop this new approach if the same failure persists for six attempts.

## Result

- Summary: Implemented per-spec isolated tauri-driver, app, and data lifecycles with remote-session DOM/screenshot capture on failed L4 cases; stabilized the scoped M4–M6 setup and assertions; registered the MW remote session; repaired startup measurement so sidecar stdin stays open through Ready. All 15 historical L4 cases and the full 44-case E2E suite pass. See `docs/reports/QA-E2E-FIX4-blocked.md` for exact verdicts, evidence paths, and TESTING.md §7 impact.
- Files changed: `e2e/wdio.conf.ts`, `e2e/helpers/diagnostics.ts`, `e2e/specs/m4/scripted-llm.spec.ts`, `e2e/specs/m4/cost.spec.ts`, `e2e/specs/m4/settings.spec.ts`, `e2e/specs/m5/knowledge.spec.ts`, `e2e/specs/m6/code.spec.ts`, `e2e/specs/mw/workflow.spec.ts`, `scripts/dev/measure-startup.mjs`, `scripts/dev/measure-startup.test.mjs`, this task file, and `docs/reports/QA-E2E-FIX4-blocked.md`.
- Dependencies added (with reason): None. Restored the lockfile-pinned optional native package to this worktree's `node_modules` with the repo-local npm cache; no manifest or lockfile was changed.
- Decisions taken within scope: Dedicated scripted ports cover the exact fallback and Escape phases; the M5 scripted reply contains a citation marker so the GUI case exercises the real citation path. Startup readiness accepts stdout or stderr and bounds child cleanup. Probe-only forced failures were removed after confirming DOM and PNG capture from the correct remote sessions.
- Verification: Scoped Prettier, `npm run typecheck`, `npm run lint`, and `npm test` passed on final source (922 Vitest passed, 1 skipped; 6/6 Node build/release tests). Focused startup tests passed 5/5; five real startup readings completed, median 3453 ms. Final configured E2E passed 14/14 specs and 44/44 cases, including all 15 historical IDs. A first full run was 13/14 specs because MW remote port 4448 was not launched; the harness was fixed and MW passed 2/2 before the final full rerun.
- Open issues / follow-ups: Independent QA must assess the remaining TESTING.md §7 exit criteria before milestone sign-off. A stale temporary directory at `C:/Users/admin/AppData/Local/Temp/itstudio-startup-4Sa0m1` was left untouched after automatic approval review rejected its recursive removal; no further deletion was attempted.
