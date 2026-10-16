# QA-E2E-FIX2 — Finish the remaining E2E cases

Role: Implementer (ROLES §1.3) · **Deps pre-installed** · Source: QA E2E session 2026-10-03 (5 specs) and `docs/qa/M4-report.md`, `M5-report.md`, `M6-report.md`.

## Remaining failures (product behaviour passes at L2/L3 — these are E2E setup issues)
| Case | Last page state | Required fix |
|---|---|---|
| TC-M6-070/071/072 | pipeline reaches VALIDATING, then `COMMAND_FAILED` — default validation command fails in the empty temp project | give the Code E2E project a deterministic validation command: either create the project with a tiny `package.json` whose `test` script passes (070, 072) / fails (071), or set `settings.pipeline.validationCommands` for the session and restore it after |
| TC-M4-023 | after "cancel fallback" no modal appears | in the scripted session: turn Auto Fallback OFF via Settings → Router, select the scripted failing model in the picker, send, then assert the modal (Use / Retry same / Cancel) and Escape; restore Auto Fallback ON |
| TC-M4-031 | Cost page renders, budget assertion never matches | read `features/cost/BudgetBars.tsx` and assert exactly what it renders after `budget.setUsd` 12.5 (limit text / aria-label); then the `1e3` validation message |
| TC-M4-043/044/045/046, TC-M5-022/023 | no `Error in` line — they fail after an earlier failure in the same spec session | isolate specs: a fresh data dir per spec file (restart the tauri-driver per spec with its own `ITSTUDIO_DATA_DIR`/`WEBVIEW2_USER_DATA_FOLDER`) **or** make each case self-contained (create its own project, reset settings in `afterEach`); then fix any real selector issues from the component code |

## Scope
`e2e/**` only. If a case proves a **product** defect, stop and write `## Blocked` with the page evidence.

## Requirements
- Keep case IDs and intent. Type-check and lint `e2e`. **Do not run E2E** (QA runs it with the user's permission).

## Hand-back
Append `## Result` per AGENTS.md §3 with a table case → change.

## Result
- Summary: Made the affected E2E setup deterministic and strengthened the brittle assertions and session steps.
- Files changed: `e2e/specs/m6/code.spec.ts`, `e2e/specs/m4/scripted-llm.spec.ts`, `e2e/specs/m4/cost.spec.ts`, `e2e/specs/m4/settings.spec.ts`.
- Dependencies added (with reason): None.
- Decisions taken within scope:

  | Case | Change |
  |---|---|
  | TC-M6-070/071/072 | Each temporary project now gets an explicit `node_modules/typescript/bin/tsc` shim that deterministically passes or fails validation as the scenario requires. |
  | TC-M4-023 | Reassert Auto Fallback OFF immediately before each scripted failing send, check the full fallback dialog actions, then exercise Use and Escape; existing `afterEach` restores Auto Fallback ON. |
  | TC-M4-031 | Assert the rendered 0% budget bar's `aria-label`, visible usage and `$0.00` output, plus the actual positive-limit validation message for `1e3`. |
  | TC-M4-043/044/045/046, TC-M5-022/023 | Kept each case on its own created project; strengthened M4 cleanup of router, budget, FX, and price settings, and made M4-044 establish its own active project before switching to All projects. |

- Open issues / follow-ups: E2E was not run, as requested. `npm run typecheck` passed (including `e2e/tsconfig.json`); scoped ESLint and Prettier checks passed.
