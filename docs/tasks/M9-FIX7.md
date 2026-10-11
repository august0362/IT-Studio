# M9-FIX7 — Keep Cost & P&L usable for incomplete custom dates

Milestone: M9 · Depends on: M9-QA exploratory finding · Roles: Architect, Implementer, QA/Reviewer (ROLES.md §§1.1–1.3)

## Goal

Prevent the Cost & P&L page from unmounting while a custom date is being edited or when the selected interval is reversed.

## Read first

- `AGENTS.md`, `CONTEXT.md`, `CONVENTIONS.md` §10, `ARCHITECTURE.md` cost/P&L sections, `TESTING.md` §7, `docs/qa/M4-test-cases.md` and `docs/qa/M9-test-cases.md` when available in the QA branch.
- `apps/desktop/src/features/cost/CostPage.tsx`, `date-range.ts`, their tests, and `e2e/specs/m4/cost.spec.ts`.

## Scope — files you may create/modify

- `apps/desktop/src/features/cost/CostPage.tsx`
- `apps/desktop/src/features/cost/CostPage.test.tsx`
- `apps/desktop/src/features/cost/date-range.ts`
- `apps/desktop/src/features/cost/date-range.test.ts`
- `e2e/specs/m4/cost.spec.ts`
- This task file for `## Result` or `## Blocked`.

The M9-QA reviewer will add the `TC-M9-015` row to its own test-case document and report after this task lands; those QA files are outside this implementation scope.

## Contracts

- Date ranges remain UTC, half-open intervals of `IsoDateTime` values. The existing `getDateRange('custom', now, custom)` fallback for missing or reversed intervals remains the behavior for invalid custom input.
- No schema, RPC, money, project data, dependency, or toolchain change.

## Requirements

1. Parse custom date inputs without calling `toISOString()` on an invalid or incomplete date. Reject impossible calendar dates as well as incomplete input.
2. Use the existing date-range fallback when either date is incomplete/invalid or when From is after To. A valid same-day selection includes that full UTC day.
3. Keep the page mounted and Ready through editing; valid dates continue to drive project and portfolio queries.
4. Add focused unit/component coverage and a GUI regression named `TC-M9-015` that repeats the observed From `2026-10-12`, To `2026-10-10` interaction and verifies the shell remains visible.
5. Record the M9-QA observation: after selecting Custom on Cost & P&L, entering those two dates emptied `<div id="root"></div>` in the WebView; screenshots and a 20-minute session clock are in `.npm-cache/m9-explore/` of the QA worktree.

## Acceptance criteria

- [ ] Incomplete/impossible custom dates cannot throw during render; reversed dates use the existing fallback; valid same-day range has the expected UTC bounds.
- [ ] `TC-M9-015` GUI test passes on the isolated debug app and verifies the Cost page and Ready status remain visible.
- [ ] Scoped Prettier, typecheck, lint, unit tests, and the prior M4 Cost GUI cases pass after merge.

## Out of scope

- Changing date-range product semantics, adding validation copy, changing the Cost backend, or altering installer files.

## Role assignment and disjoint work

- Architect: writes this work order and records the observed WebView failure.
- Implementer: changes only Cost page/date-range logic and corresponding tests in `C:/Users/admin/itstudio-wt/M9-FIX7`.
- QA/Reviewer: checks CONVENTIONS.md §10, source and GUI gates, and repeats the dates in the final M9-QA app. This scope does not overlap M9-FIX6's WiX template or test.
