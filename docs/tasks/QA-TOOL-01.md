# QA-TOOL-01 — Restore meaningful Stryker mutation results

Milestone: M9 quality follow-up · Depends on: M6-QA · Role: Implementer (ROLES §1.3) · **Deps pre-installed**

## Goal

Make the existing StrykerJS 10 / Vitest 5 setup execute relevant sidecar tests against each mutant so a deliberately testable mutation is killed and the reported score reflects real test outcomes.

## Read first

- `AGENTS.md`, `../CONTEXT.md`, `../CONVENTIONS.md`, `../TESTING.md` §4, `docs/qa/M6-report.md`, `docs/tasks/M6-QA.md`.
- `stryker.config.mjs`, `vitest.config.ts`, `package.json` (read-only), and the tests for `apps/sidecar/src/domain/template.ts`.

## Scope — files you may create/modify

- `stryker.config.mjs`.
- `vitest.stryker.config.ts` (new, only if a dedicated Vitest config is needed).
- `docs/tasks/QA-TOOL-01.md` (append `## Result` or `## Blocked` only).

## Contracts

Use the existing `npm run test:mutation` script and pinned StrykerJS 10 / Vitest 5 dependencies. Do not change source contracts, package manifests, lockfiles, application code, or existing tests.

## Requirements

1. Identify why the current workspace configuration reported approximately 0–2.5% killed mutants while a manual mutation in `template.ts` was killed by TC-M6-060. Record the cause with command output or runner evidence.
2. Configure Stryker to run the sidecar Vitest project against the four existing mutation targets (`path-guard.ts`, `write-transaction.ts`, `pipeline-machine.ts`, `template.ts`) without changing their test semantics.
3. Demonstrate that a focused `template.ts` mutation run has killed mutants, no runner/config errors, and nonzero meaningful coverage. Run the configured full mutation command once and record killed/survived/uncovered counts and score. Do not claim a quality threshold that the source tests have not actually met.
4. Keep execution bounded and avoid redundant full-suite reruns. Do not add dependencies or alter the pinned toolchain; append `## Blocked` if that is required.

## Acceptance criteria (verifiable)

- [ ] `npx prettier --write <changed files>` runs first; `npm run typecheck`, `npm run lint`, and `npm test` pass.
- [ ] The focused mutation run on `template.ts` reports at least one killed mutant and no runner/config errors.
- [ ] `npm run test:mutation` completes and reports counts for all four configured targets; the report distinguishes tooling failures from surviving mutants.
- [ ] Configuration changes stay within the listed Scope and `## Result` records measured evidence and any remaining score gap.

## Out of scope

- Changing production behavior or tests to raise the mutation score.
- Dependency upgrades, version pins, global tool installation, and unrelated QA tooling.

## Hand-back

Append `## Result` per AGENTS.md §3, including exact commands, counts, cause, files changed, and open issues. If the runner cannot be corrected within scope, append `## Blocked` with the precise evidence and question.

## Result

- Summary: Restored meaningful Stryker results for the four sidecar targets. Vitest 5 builds a nested `fullTestName` such as `renderTemplate > TC-M6-060 ...`, while the pinned Stryker 10 runner filters with `renderTemplate TC-M6-060 ...`. `npx vitest run --config vitest.stryker.config.ts apps/sidecar/src/domain/template.test.ts -t "renderTemplate TC-M6-060" --reporter=dot` skipped all four tests during diagnosis, matching Stryker's original `0.00 tests per mutant` and `0 killed / 48 survived` baseline. The configured adapter retains Stryker's covering-file selection and runs all tests in each selected file; the existing root Vitest workspace provides the sidecar project.
- Files changed: `stryker.config.mjs`, `docs/tasks/QA-TOOL-01.md`. No application source, existing tests, manifests, lockfiles, or schema contracts changed.
- Dependencies added (with reason): None. The adapter uses the API and Vitest runner already installed by the pinned Stryker packages.
- Decisions taken within scope: Limited Stryker to two workers. Kept `coverageAnalysis: 'perTest'` and `vitest.related: true`; expanded mutant execution from a covering test name to all tests in its covering file because Stryker 10 and Vitest 5 disagree on the suite separator. The `stryker.config.mjs` default export is required by Stryker's config loader.
- Mutation evidence: `npx stryker run --mutate apps/sidecar/src/domain/template.ts --logLevel info` completed with 47 killed, 1 survived, 0 uncovered, 0 errors, 97.92% score, and 3.88 tests per mutant. Final `npm run test:mutation` completed in 5m34s with 584 killed, 110 survived, 3 timed out, 2 uncovered, 0 errors, 83.98% total score (84.22% covered), and 14.19 tests per mutant. Per file (killed / survived / timed out / uncovered): `path-guard.ts` 132 / 16 / 2 / 0; `pipeline-machine.ts` 13 / 0 / 0 / 0; `template.ts` 47 / 1 / 0 / 0; `write-transaction.ts` 392 / 93 / 1 / 2. This is a measured score; the remaining mutants are not addressed by this configuration task.
- Verification: `npx prettier --write stryker.config.mjs` and `npm run typecheck` passed. `npx eslint stryker.config.mjs --max-warnings 0`, `npx prettier --check stryker.config.mjs`, and `node scripts/scan-secrets.mjs stryker.config.mjs` passed. `npm run lint` failed because the generated, untracked `.stryker-tmp` sandbox contains `@ts-nocheck` copies that ESLint scans. Two `npm test` attempts each had 920 passing, 1 skipped, and 2 failures in unrelated existing suites; the failing cases changed between runs. The two desktop files passed 7/7 focused, and the two RAG files passed 15/15 focused. QA should run the full gates serially in a clean checkout after concurrent packaging work ends.
- Open issues / follow-ups: The 110 survivors, 2 uncovered mutants, and 3 timeouts remain for future test-quality review; no runner/config errors occurred. The adapter imports a Stryker 10 internal runner path and must be revisited when Stryker is upgraded. Automatic command policy rejected two `Remove-Item` attempts on `.stryker-tmp` even after its resolved path was verified inside this worktree; it remains untracked and must not be staged or merged.

## QA review (2026-10-11)

- Reviewer: Verified the committed scope contains only this task file and `stryker.config.mjs`; generated `.stryker-tmp` is absent from the staged change. `git diff --check`, `npx prettier --write stryker.config.mjs`, `npm run typecheck`, `npm run lint`, and `npm test` passed in the clean main checkout with the task merge prepared. The unit gate reported 922 passed and 1 skipped, plus 6 passing Node build/release tests.
- Verdict: Pass for the QA tooling repair. The measured 83.98% mutation score exceeds the 70% periodic target in ../TESTING.md §4; surviving mutants remain a separate test-quality follow-up, not a runner failure.
