# M6-QA — Automate the M6 test-case specification (+ fix TC-M6-060 defect)

Milestone: M6 · Role: Implementer (ROLES §1.3) · **Deps pre-installed** (`@stryker-mutator/core` + `vitest-runner` ~10.0)

## Read first
- `AGENTS.md`, `TESTING.md`, **`docs/qa/M6-test-cases.md`** (your work order), existing pipeline / worker tests, `apps/sidecar/test/integration/pipeline.test.ts`

## Scope
- Tests: `apps/sidecar/src/{domain,services}/**/*.test.ts` for pipeline, worker, command runner, path guard, template, role caller, journal; `apps/sidecar/src/container.test.ts` (temp dataDir only); `apps/sidecar/test/integration/pipeline*.test.ts` (+ new `pipeline-*.test.ts`), `apps/sidecar/test/fixtures/sample-project/**`, `e2e/specs/m6/**`. Other QA tasks edit M3 / RAG tests in parallel — do not touch them.
- Product fix: `apps/sidecar/src/domain/template.ts` (TC-M6-060, case-insensitive neutralisation). Other production code only if a new test exposes a defect — fix minimally and list it under *Decisions*.
- Mutation testing: `stryker.config.mjs` (repo root) + root `package.json` script `test:mutation` (scripts only).

## Requirements
1. Implement every case marked **new** / **defect** and complete every **verify** / **add L3** item; case ID in the test name.
2. Rename the E2E test `TC-M6-010` in `code.spec.ts` to `TC-M6-070`; write TC-M6-071/072 there but **do not run E2E**.
3. Crash-recovery cases (TC-M6-030/031): kill the spawned sidecar between stages using a test-only hook already available or a new env flag `ITSTUDIO_E2E_CRASH_AT=<stage>` honoured only when `ITSTUDIO_E2E=1`.
4. Gates: `command-runner.ts` ≥ 90 %, `template.ts` 100 %, `path-guard.ts` / `write-transaction.ts` stay 100 % branches; run Stryker on the four listed files and report the score (target ≥ 80 %; below target → list surviving mutants under *Open issues*).
5. No real network, no GUI/E2E runs.

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0; coverage gates met; mutation score reported; QA runs integration

## Hand-back
Append `## Result` per AGENTS.md §3 including a table: case ID → test file → status, and the mutation score.

## Result
- Summary: Added M6 QA coverage, fixed case-insensitive context-tag neutralization, added test-gated crash hooks and validation cancellation, and published rollback reports for startup recovery.
- Files changed: `apps/sidecar/src/container.test.ts`, `apps/sidecar/src/container.ts`, `apps/sidecar/src/domain/path-guard.test.ts`, `apps/sidecar/src/domain/template.test.ts`, `apps/sidecar/src/domain/template.ts`, `apps/sidecar/src/services/command-runner.test.ts`, `apps/sidecar/src/services/command-runner.ts`, `apps/sidecar/src/services/journal-recovery.test.ts`, `apps/sidecar/src/services/pipeline-orchestrator.test.ts`, `apps/sidecar/src/services/pipeline-orchestrator.ts`, `apps/sidecar/src/services/role-caller.test.ts`, `apps/sidecar/src/services/write-transaction.test.ts`, `apps/sidecar/src/services/write-transaction.ts`, `apps/sidecar/test/integration/pipeline.test.ts`, `e2e/specs/m6/code.spec.ts`, `package.json`, `stryker.config.mjs`, `docs/tasks/M6-QA.md`.
- Dependencies added (with reason): None. Existing preinstalled Stryker dependencies used.
- Decisions taken within scope: Crash injection exits only when both `ITSTUDIO_E2E=1` and the requested crash stage match. Validation cancellation now passes an `AbortSignal` to the process runner. Startup recovery emits a `pipeline.failureReport` for each restored transaction. No shared schemas changed.
- Open issues / follow-ups:
  - L3 integration launch is blocked in this sandbox: all 63 integration cases failed before sidecar startup because `tsx` calls `os.userInfo()` and Node reported `uv_os_get_passwd returned ENOMEM`. QA should rerun integration outside this sandbox.
  - E2E was not run as requested; TC-M6-070/071/072 only passed TypeScript compilation.
  - The final full `npm test` rerun had 694 passing, 1 skipped, and 1 failure: the unrelated desktop theme lint test timed out at 20 seconds under load. All 104 tests across the changed sidecar suites passed in a focused rerun; an earlier full run passed 689 tests.
  - Stryker completed with 2.53% mutation score: 16 killed, 609 survived, 7 uncovered, 0 timed out, across 632 mutants. This is below the 80% target. Survivors by file: `path-guard.ts` 146, `write-transaction.ts` 410, `pipeline-machine.ts` 5, `template.ts` 48; uncovered mutants: 7. Stryker reported only 16 killed despite executing the initial Vitest dry run; investigate Vitest per-test coverage/test correlation before treating this as a meaningful quality score. Stryker's final cleanup also logged Windows `taskkill` access denied after producing the score.

| Case ID | Test file | Status |
|---|---|---|
| TC-M6-001, TC-M6-002, TC-M6-023, TC-M6-030, TC-M6-031, TC-M6-041, TC-M6-042, TC-M6-044, TC-M6-052 | `apps/sidecar/test/integration/pipeline.test.ts` | Implemented; L3 execution blocked by sandbox `tsx` / `os.userInfo()` failure |
| TC-M6-003, TC-M6-004, TC-M6-010, TC-M6-011, TC-M6-012, TC-M6-050, TC-M6-051 | `apps/sidecar/src/services/pipeline-orchestrator.test.ts` | Implemented; unit suite passed |
| TC-M6-005, TC-M6-006, TC-M6-061 | `apps/sidecar/src/services/role-caller.test.ts` | Implemented; unit suite passed |
| TC-M6-020, TC-M6-021, TC-M6-022, TC-M6-024, TC-M6-025, TC-M6-026 | `apps/sidecar/src/domain/path-guard.test.ts` | Implemented; 100% branch coverage |
| TC-M6-032, TC-M6-033 | `apps/sidecar/src/services/write-transaction.test.ts` | Implemented; 100% branch coverage |
| TC-M6-030, TC-M6-031 | `apps/sidecar/src/services/journal-recovery.test.ts` | Implemented; unit suite passed |
| TC-M6-040, TC-M6-041, TC-M6-042, TC-M6-043, TC-M6-044 | `apps/sidecar/src/services/command-runner.test.ts` | Implemented; unit suite passed |
| TC-M6-060 | `apps/sidecar/src/domain/template.test.ts` | Implemented; unit suite passed |
| TC-M6-070, TC-M6-071, TC-M6-072 | `e2e/specs/m6/code.spec.ts` | Implemented and typechecked; E2E intentionally not run |

Coverage: `command-runner.ts` 95.83% branches; `template.ts` 100% branches; `path-guard.ts` 100%; `write-transaction.ts` 100%. Stryker reports 48 surviving template mutants, so mutation instrumentation needs QA review.
- Final verification note: A final full `npm test` rerun reported 694 passed, 1 skipped, and 1 unrelated failure because the desktop theme ESLint test exceeded its 20-second timeout under load; all 104 changed sidecar tests passed in the focused run. The follow-up Stryker run after adding test-only crash-hook coverage was stopped at 3%; the reported 2.53% score is from the earlier completed run.

## QA (Claude)
- Verdict: **PASS**. Product fixes accepted: case-insensitive `</context\s*>` neutralisation (TC-M6-060, S2), validation cancel via `AbortSignal`, failure reports for startup-recovered transactions, test-only crash hooks gated by `ITSTUDIO_E2E=1`. QA test-design fix: TC-M6-031's two-file commit needed the spec to allow `src/second.txt` (the run was correctly rejected before WRITING). After merging main: typecheck ✔, lint ✔, 695 unit ✔, integration 66/67 → pipeline file 10/10 ×2 after the fix. Coverage: `command-runner.ts` 95.8 %, `template.ts` / `path-guard.ts` / `write-transaction.ts` 100 %.
- Mutation: Stryker 10 + Vitest 5 reported 2.5 % (and 0 % in QA re-runs with sidecar-only / in-place configs) — a tooling incompatibility, not a quality signal: a manual mutant (dropping the `i` flag in `template.ts`) is killed by TC-M6-060. Follow-up QA-TOOL-01.
