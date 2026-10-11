# M9-FIX5 — Ignore Stryker's generated sandbox in source gates

Milestone: M9 · Depends on: M9-QA mutation run · Roles: Architect, Implementer, QA/Reviewer (ROLES.md §§1.1–1.3)

## Goal

Keep generated `.stryker-tmp/` sandboxes out of Git status, ESLint, Prettier, and the secret scanner so the required post-mutation lint gate can run on repository source.

## Read first

- `AGENTS.md`, `CONTEXT.md`, `CONVENTIONS.md` §10, `TESTING.md` §4, `docs/tasks/M9-QA.md`.
- `.gitignore`, `.prettierignore`, `eslint.config.js`, and `scripts/scan-secrets.mjs`.

## Scope — files you may create/modify

- `.gitignore` (one generated-directory rule).
- `.prettierignore` (one generated-directory rule).
- `eslint.config.js` (one generated-directory ignore).
- This task file for `## Result` or `## Blocked`.

No package manifest, lockfile, product file, or generated sandbox contents are in scope. Do not delete or move the sandbox.

## Contracts

- Existing source files remain under all lint, format, and secret-scan rules.
- `scripts/scan-secrets.mjs` enumerates files with `git ls-files -co --exclude-standard`; a Git ignore for `.stryker-tmp/` excludes generated sandbox copies from this scanner.

## Requirements

1. Ignore only the root `.stryker-tmp/` directory in the three existing ignore mechanisms. Preserve all other rules.
2. Record the QA evidence: full-domain Stryker exited 0 but left three sandbox directories in `.stryker-tmp/`; the subsequent `npm run lint` exited 1 after Node exhausted its heap while scanning those generated copies. The sandbox remains untouched for this fix.
3. Verify the ignore rules with `git check-ignore` and run the full lint gate in the M9-QA worktree while the generated directory still exists.

## Acceptance criteria

- [ ] Git, Prettier, and ESLint exclude `.stryker-tmp/`; existing tracked source remains checked.
- [ ] Scoped Prettier, `npm run typecheck`, `npm run lint`, and `npm test` pass after merge into M9-QA with the generated sandbox present.
- [ ] No sandbox files are deleted or moved and no dependency/toolchain version changes occur.

## Out of scope

- Changing Stryker settings, deleting temporary data, or weakening source lint rules.

## Role assignment and disjoint work

- Architect: writes this work order with the observed failure.
- Implementer: edits only the three ignore files in a dedicated `M9-FIX5` worktree; scope is disjoint from M9-QA's tests/report.
- QA/Reviewer: checks the exact ignores against CONVENTIONS.md §10 and verifies the full source gates in M9-QA.
