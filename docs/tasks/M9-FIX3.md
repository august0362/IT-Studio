# M9-FIX3 — Keep the Windows lint secret scan below the command-line limit

Milestone: M9 · Depends on: M9-QA discovery · Roles: Architect, Implementer, QA/Reviewer (ROLES.md §§1.1–1.3)

## Goal

Restore the required `npm run lint` gate on Windows after the tracked file list grew beyond the process argument limit.

## Read first

- `AGENTS.md`, `CONTEXT.md`, `CONVENTIONS.md` §10, `TESTING.md`, `docs/tasks/M9-QA.md`.
- `package.json`, `scripts/scan-secrets.mjs`, and `scripts/lint-fixtures/selftest.mjs`.

## Scope — files you may create/modify

- `package.json` (the `lint` script only; no dependency or version changes).
- `scripts/lint-fixtures/selftest.mjs` (focused regression for the no-argument scanner path).
- This task file for `## Result` or `## Blocked`.

The package lockfile, scanner implementation, and all product code are out of scope.

## Contracts

- `npm run lint` still runs ESLint, Prettier, and the repository secret scan in order.
- `scripts/scan-secrets.mjs` with no arguments already reads Git's tracked and untracked files, excludes `scripts/lint-fixtures/`, and reports only a finding's path, line, and pattern name.
- An explicit scanner file argument still checks the named test fixture and reports a failure without printing the fake key.

## Requirements

1. Replace the inline wrapper that sends every repository path as a child-process argument with the scanner's existing no-argument repository mode. Do not change versions, dependencies, or scanner rules.
2. Add a focused self-test that executes the no-argument scanner and checks successful completion while the bad-secret fixture remains excluded; preserve the existing explicit-argument negative fixture.
3. Record the diagnostic: on the M9-QA branch, 833 paths totaled 32,708 characters and `spawnSync` returned `ENAMETOOLONG`, leaving `npm run lint` with exit code 1 and no diagnostic output. Direct no-argument scanning exited 0.

## Acceptance criteria

- [ ] `npm run lint:selftest` and `npm run lint` pass on the M9-QA final source after this fix is merged.
- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, and `npm test` pass; no manifest version or dependency changes occur.
- [ ] The explicit bad-secret fixture is still rejected and its value is never printed.

## Out of scope

- Product behavior, schema changes, dependency changes, or a new lint tool.

## Role assignment and disjoint work

- Architect: writes this work order and records the observed failure.
- Implementer: edits only the `lint` script and its focused self-test in a dedicated `M9-FIX3` worktree. This scope is disjoint from M9-QA's tests and report.
- QA/Reviewer: checks CONVENTIONS.md §10, reruns the gates, then merges the fix before resuming M9-QA.

## Result

- Summary: Changed the lint secret-scan step to call the scanner's existing no-argument repository mode. The self-test now checks that this mode succeeds with the bad-secret fixture excluded, while the explicit fixture scan still rejects the fixture without printing its value.
- Files changed: `package.json` (`lint` script only), `scripts/lint-fixtures/selftest.mjs`, and this task file.
- Dependencies added (with reason): None. The package lockfile and version/dependency fields were not changed.
- Decisions taken within scope: Reused the scanner's own Git file enumeration and fixture exclusion, so lint no longer passes repository paths as child-process arguments. On the M9-QA branch, the former wrapper passed 833 paths totaling 32,708 characters; `spawnSync` returned `ENAMETOOLONG`, and lint exited 1 without diagnostic output. Direct no-argument scanning exited 0.
- Verification: The pinned Prettier from the M9-QA worktree ran `--write` on both changed code files with no formatting changes. `node --check scripts/lint-fixtures/selftest.mjs` passed. `node scripts/scan-secrets.mjs` exited 0. `node scripts/scan-secrets.mjs scripts/lint-fixtures/bad-secret.txt` exited 1 and printed only `scripts/lint-fixtures/bad-secret.txt:1: openai-api-key`. `git diff --check` passed.
- Open issues / follow-ups: This dedicated worktree has no `node_modules`; per the hand-back instruction, npm dependency installation and the `lint:selftest`, typecheck, lint, and test gates are deferred to QA on the M9-QA final source after merge.
