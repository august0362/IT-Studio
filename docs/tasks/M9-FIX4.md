# M9-FIX4 — Separate the chunker speed check from instrumented mutation runs

Milestone: M9 · Depends on: M9-QA mutation gate · Roles: Architect, Implementer, QA/Reviewer (ROLES.md §§1.1–1.3)

## Goal

Run the required Stryker mutation check over `apps/sidecar/src/domain/**` while preserving the existing one-second chunker speed assertion in normal tests.

## Read first

- `AGENTS.md`, `CONTEXT.md`, `CONVENTIONS.md` §10, `TESTING.md` §4, `docs/tasks/M9-QA.md`.
- `apps/sidecar/src/domain/chunker.test.ts` and `stryker.config.mjs`.

## Scope — files you may create/modify

- `apps/sidecar/src/domain/chunker.test.ts` (guard only the generated 5 MB timing case during instrumented mutation runs).
- This task file for `## Result` or `## Blocked`.

No application code, mutation configuration, package manifest, or lockfile is in scope.

## Contracts

- The normal unit and coverage suites must keep the exact one-second assertion and all functional chunker cases.
- `ITSTUDIO_MUTATION=1` is a QA-only environment marker for the Stryker command. It must skip only the wall-clock timing case; all other chunker tests must run.

## Requirements

1. Use Vitest's supported conditional skip for only `chunks a generated 5 MB markdown document within one second` when `ITSTUDIO_MUTATION=1`; explain briefly that mutation instrumentation invalidates wall-clock timing.
2. Do not weaken the normal timing threshold, input size, or functional checks.
3. Record that two full-domain Stryker dry runs failed before mutants ran: 1,437.7 ms with another QA step active and 1,479.0 ms when run alone, both against the 1,000 ms test limit. The normal unit suite and coverage passed.

## Acceptance criteria

- [ ] Normal `npm test` runs the timing case and passes; a focused `ITSTUDIO_MUTATION=1` run reports that one case skipped while the other chunker cases pass.
- [ ] Full-domain mutation dry-run proceeds past the initial tests and the final mutation score is recorded by M9-QA.
- [ ] Scoped Prettier, typecheck, lint, and tests pass after merge; no dependency or schema change occurs.

## Out of scope

- Relaxing the normal performance target, production changes, or toolchain changes.

## Role assignment and disjoint work

- Architect: writes this scoped work order and records the observed dry-run failures.
- Implementer: edits only the chunker test in a dedicated `M9-FIX4` worktree. This scope is disjoint from M9-QA's test/report files.
- QA/Reviewer: verifies the normal and marked runs, then executes Stryker over `domain/**` and the full M9 regression gate.

## Result

- Summary: Guarded only the generated 5 MB, one-second chunker timing case with Vitest `it.skipIf(process.env.ITSTUDIO_MUTATION === '1')`. Mutation instrumentation invalidates wall-clock timing; normal runs retain the original input and 1,000 ms assertion.
- Files changed: `apps/sidecar/src/domain/chunker.test.ts`; this task file.
- Dependencies added (with reason): None.
- Decisions taken within scope: Keep all other chunker cases active in both modes. The two full-domain Stryker dry runs before this fix failed before mutants ran: 1,437.7 ms with another QA step active and 1,479.0 ms alone, each above the 1,000 ms limit. The normal unit suite and coverage had passed.
- Open issues / follow-ups: This worktree has no `node_modules`; M9-QA must verify normal and marked Vitest runs, the full-domain mutation score, and the post-merge typecheck, lint, and test gates. Scoped Prettier check and `git diff --check` passed.
