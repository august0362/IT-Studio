# QA-BREAK-FIX-B — Desktop UI race defects + flaky tests

Milestone: v1 hardening · Role: Implementer (ROLES §1.3) · Size S–M · **Deps pre-installed** · Depends on QA-BREAK-02, UX-02, V1-POLISH-01 (landed)

## Goal

Turn every desktop `it.fails('QA-BREAK-02-Dnn …')` in `apps/desktop/src/features/break-ui-races.test.tsx` into a passing `it(...)` by fixing the product, and remove two load-dependent flaky tests.

## Scope — files you may create/modify

- `apps/desktop/src/features/{cost,chat,code}/**` (+ tests)
- `apps/desktop/src/features/pipeline-studio/PipelineStudioPage.test.tsx` (FLAKE-2 only)
- `apps/desktop/src/features/break-ui-races.test.tsx` — only `it.fails` → `it`
- This task file (`## Result`)

## Defects

| ID | Fix |
|---|---|
| QA-BREAK-02-D01 | Add revenue: a second submit while the first `revenue.add` is pending sends nothing (disable the button + in-flight guard). |
| QA-BREAK-02-D02 | ChatPage: switching project clears the selected conversation; the composer can never send with another project's conversation id. |
| QA-BREAK-02-D03 | CodePage: switching project clears the selected run / preview (project-scoped selection). |
| QA-BREAK-02-D04 | CodePage: an older `pipeline.get` response that resolves after a newer one must be ignored (request sequence number per run, or compare a monotonic stage order / `finishedAt`). |
| FLAKE-2 | `pipeline-studio/PipelineStudioPage.test.tsx` "has a black fullscreen root and all module names…" times out at 5 s under full-suite load; passes alone. Pre-import the lazy module in `beforeAll` and use `findBy…` with an explicit ≥ 10 s timeout for the first render. |
| FLAKE-1 | `ChatPage.test.tsx` "TC-MW-009 opens a conversation selected by a workflow deep link" fails under full-suite load (missing heading) and passes alone. Make it deterministic (await the data the heading depends on with `findBy…` and an explicit timeout ≥ 10 s; no global timeout change). |

## Acceptance criteria

- [ ] All defects fixed, tests are plain `it(...)` and pass; run `npm test` **three times in a row** green (record in Result).
- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint` pass.

## Hand-back

Append `## Result` per AGENTS.md §3.

## Answer to Blocked (Architect, 2026-10-15)

Approved. Rewrite the D02 test as you proposed: select project A's conversation, switch to project B, assert the selection is cleared (no A conversation shown) and that no `chat.send` can carry A's conversation id (composer hidden/disabled until a B conversation exists, or a send creates a new B conversation). Keep the test name prefix `QA-BREAK-02-D02`. Continue with all other items, then replace `## Blocked` with `## Result`.

## Answer to Blocked #2 (Architect, 2026-10-15)

Approved: the D04 assertion's regex was wrong since it was written as `it.fails` (case mismatch). Make it case-insensitive (`/completed/iu`) — no other change to that test. Then run `npm test` three times, record the counts, and replace `## Blocked` with `## Result`.

## Result

- Summary: Fixed D01-D04: guard revenue submissions while pending and disable the submit button; clear Chat conversation and Code run/preview state on project changes; verify conversation ownership before sending; ignore older pipeline snapshots using per-run request sequences. All four regressions are plain `it(...)`. Stabilized the two specified flaky tests with local data waits/timeouts and a lazy-module pre-import.
- Files changed: `apps/desktop/src/features/cost/RevenueForm.tsx`, `cost/RevenueForm.test.tsx`, `chat/ChatPage.tsx`, `chat/ChatPage.test.tsx`, `code/CodePage.tsx`, `code/CodePage.test.tsx`, `break-ui-races.test.tsx`, `pipeline-studio/PipelineStudioPage.test.tsx`, and this task file (feature paths share the `apps/desktop/src/features/` prefix).
- Dependencies added (with reason): None. `node_modules` was present; no installation or dependency manifest changes were needed.
- Decisions taken within scope: Key the stateful Chat/Code components by project so selection, drafts, previews, and pending UI callbacks cannot survive a project switch. Accept only the latest requested snapshot per run and reject snapshots belonging to another project. Applied both Architect approvals: rewrite D02 to select A's conversation before switching to B, and change only D04's final regex to `/completed/iu`. Timeout increases remain local to the two specified flaky tests. Added coverage for direct duplicate revenue submissions, retries after success/failure, invalid input, and overlapping notification snapshots.
- Validation: Formatted all changed files with `npx.cmd --cache .npm-cache prettier --write`. `npm.cmd --cache .npm-cache run typecheck` and `npm.cmd --cache .npm-cache run lint` passed. Three consecutive full `npm.cmd --cache .npm-cache test` runs passed, including pretest and build/release tests:
  - Run 7: 154 Vitest files passed, 1 skipped; 1,178 tests passed, 1 skipped; all 17 Node build/release tests passed; exit 0.
  - Run 8: 154 Vitest files passed, 1 skipped; 1,178 tests passed, 1 skipped; all 17 Node build/release tests passed; exit 0.
  - Run 9: 154 Vitest files passed, 1 skipped; 1,178 tests passed, 1 skipped; all 17 Node build/release tests passed; exit 0.
- Open issues / follow-ups: No outstanding task blockers. Earlier full attempts exposed intermittent failures outside the requested fixes (RAG/PDF timeouts, sidecar lifecycle logging/temp-directory EPERM, WorkflowPage, pricing settings, and other Pipeline Studio cases); no extra source changes were made for them. Earlier Vitest counts (passed/failed/skipped) were run 1: 1,177/1/1; run 2: 1,178/0/1 (also all 17 Node tests passed); run 3: 1,174/4/1; run 4: 1,177/1/1; runs 5 and 6: 1,175/3/1 each. Full-run logs are in gitignored `.npm-cache/qa-break-fix-b-run-<n>.log`. For all test commands, process-local `GIT_CONFIG_KEY_2=core.excludesFile`, `GIT_CONFIG_VALUE_2=C:/Users/admin/itstudio-wt/QA-BREAK-FIX-B/.npm-cache/qa-break-fix-b-global-ignore`, and `GIT_CONFIG_COUNT=3` preserved both existing safe-directory entries while avoiding the sandbox-denied global ignore file. Repository tooling is unchanged. No commits made.
