# REPO-02 — Fix references after archiving completed tasks

Role: Implementer · Size S · **Deps pre-installed** · **Broad scope: path-text edits anywhere in `docs/**`, `CHANGELOG.md`, `AGENTS.md`, `scripts/**`, code comments in `apps/**`, `src/**`, `e2e/**`, `.claude/**` — do not stop for path-only edits; list them in Result.** Codex must not run git write commands (the Architect already did the `git mv`).

## What changed (commit "docs: archive completed task and QA files by milestone")

- Completed task files moved from `docs/tasks/<ID>.md` to `docs/tasks/archive/<group>/<ID>.md`, groups: `M1`…`M9` (by ID prefix), `MW`, `owner-feedback` (OWNER-*, UX-*, WC-*, PROV-*, PROC-*, PSTUDIO-*, VSC-*), `hardening` (everything else that was completed).
- Still in `docs/tasks/`: future/active tasks (M10–M19, MOD-*, LLMPOOL-*, REL-V2/V3, README, REPO-02, ORCH-* when added).
- `docs/qa/M*-*.md` and `docs/qa/MW-*.md` moved to `docs/qa/archive/`.

## Requirements

1. Update every reference (Markdown links and plain path text) to a moved file so it points to the new location, with correct relative paths from the referencing file. Use `git ls-files docs/tasks/archive docs/qa/archive` for the mapping and `git grep` to find references.
2. Update `docs/tasks/README.md` (if it describes the folder) with a short "archive/" explanation.
3. Extend `scripts/dev/repo-layout.test.mjs` with a check that every relative Markdown link in `docs/**` resolves to an existing file (ignore http(s) links and anchors).
4. `scripts/dev/run-task.sh` keeps working for tasks in `docs/tasks/` (no change expected; verify).

## Acceptance criteria

- [ ] `npx prettier --write` on changed non-Markdown files; `npm run typecheck`, `npm run lint`, and `node --test scripts/dev/*.test.mjs` pass.
