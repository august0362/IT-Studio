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

- [x] Git, Prettier, and ESLint exclude `.stryker-tmp/`; existing tracked source remains checked.
- [x] Scoped Prettier, `npm run typecheck`, `npm run lint`, and `npm test` pass after merge into M9-QA with the generated sandbox present.
- [x] No sandbox files are deleted or moved and no dependency/toolchain version changes occur.

## Out of scope

- Changing Stryker settings, deleting temporary data, or weakening source lint rules.

## Role assignment and disjoint work

- Architect: writes this work order with the observed failure.
- Implementer: edits only the three ignore files in a dedicated `M9-FIX5` worktree; scope is disjoint from M9-QA's tests/report.
- QA/Reviewer: checks the exact ignores against CONVENTIONS.md §10 and verifies the full source gates in M9-QA.

## Result

- Summary: Added root-only `.stryker-tmp/` exclusions to Git, Prettier, and ESLint. The M9-QA mutation run exited 0 and left three generated sandboxes; its following lint run exited 1 when Node exhausted its heap while scanning those copies. The sandboxes were left untouched.
- Files changed: `.gitignore`, `.prettierignore`, `eslint.config.js`, and this task result.
- Dependencies added (with reason): None.
- Decisions taken within scope: Used a leading root slash in the Git and Prettier ignore files and a root-relative ESLint glob. `git check-ignore -v` excludes `.stryker-tmp/synthetic/file.ts` and does not exclude `apps/sidecar/.stryker-tmp/synthetic/file.ts`. Prettier `--file-info` reports the same root-only behavior; formatting `eslint.config.js` was unchanged. `git diff --check` passes.
- Open issues / follow-ups: None for this fix. QA verified scoped Prettier, typecheck, lint, and 923 Vitest plus 14 Node tests in M9-QA with the generated sandboxes still present. An initial full test run had four load-related timeouts; the four files passed 22/22 when isolated and the full rerun passed.
