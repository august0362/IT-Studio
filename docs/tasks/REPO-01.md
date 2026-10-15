# REPO-01 — Tidy the repository root + one-click start script

Milestone: v1 hardening · **Run after QA-BREAK-FIX-A/B land, before V1-QA** · Role: Implementer (ROLES §1.3) · Size S · **Broad scope: do not stop for path-only edits outside the list — record them in Result** · **Deps pre-installed**

## Goal

1. Move the project documents out of the repository root into `docs/` so the root only holds what tools require.
2. Add `Start-IT-Studio.bat` at the root: double-click → the app starts from source.
3. Stop load-dependent unit-test flakes: in `vitest.config.ts` set `testTimeout: 15_000` and `hookTimeout: 20_000` for the unit projects (desktop, sidecar, vscode-ext). Remove per-test timeout overrides below 15 s that exist only to work around load. Integration config unchanged.

## Scope — files you may create/modify/move

- Move with `git mv` (history kept): `CONTEXT.md`, `ARCHITECTURE.md`, `CONVENTIONS.md`, `ROADMAP.md`, `ROLES.md`, `TESTING.md` → `docs/`; `diagram.png` → `docs/diagram.png`.
- **Stay at the root** (tools require it): `AGENTS.md` (Codex reads it from the root), `CHANGELOG.md` (used by `release:bump`), `package.json`, `package-lock.json`, `tsconfig*.json`, `eslint.config.js`, `vitest*.config.ts`, `stryker.config.mjs`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `.gitattributes`.
- **Reference updates (explicitly allowed for this task only, path text only — no wording changes):** every file that mentions one of the moved files by path or name, including `AGENTS.md`, `CHANGELOG.md` links, all of `docs/**` (incl. `docs/tasks/*.md`, `docs/qa/*.md`, `docs/HANDOFF.md`, `docs/RUNNING.md`), `scripts/**`, code comments in `apps/**`, `src/**`, `e2e/**`, `.claude/**` agent definitions, and the root `README` if one exists. Use `git grep -n -E "(CONTEXT|ARCHITECTURE|CONVENTIONS|ROADMAP|ROLES|TESTING)\.md|diagram\.png"` before and after; after the change every hit must point to the new location (relative links from inside `docs/` become sibling links, e.g. `docs/tasks/X.md` → `../CONTEXT.md`).
- `scripts/dev/run-task.sh` / `land-task.sh` and any script that reads these paths: update paths.
- New: `Start-IT-Studio.bat` (root).
- `vitest.config.ts` (timeouts only) and test files where a sub-15 s per-test timeout override is removed.
- Anything else strictly needed to make the moves work (e.g. a path in `package.json` scripts, `.prettierignore`, `tsconfig` includes) — list each in Result instead of stopping to ask.
- This task file (`## Result`).

## `Start-IT-Studio.bat` requirements

- Works by double-click from Explorer and from `cmd`; `cd /d "%~dp0"` first (path contains spaces).
- Checks `node` and `npm` are on PATH; if not, prints a clear Vietnamese + English message with the Node.js download URL and pauses.
- If `node_modules` is missing **or** `package-lock.json` is newer than `node_modules\.package-lock.json`, runs `npm install` (no `--force`), stops with a message on failure.
- Checks `cargo` is on PATH (needed by `tauri dev`); if missing, prints how to install Rust (rustup URL) and pauses.
- Prints a short banner: "IT Studio — starting from source. First start compiles the Rust shell (a few minutes)."
- Runs `npm run dev`; when it exits with a non-zero code, prints the exit code and `pause`s so the window does not vanish.
- Optional argument `--data-dir <folder>` sets `ITSTUDIO_DATA_DIR` for a throw-away data folder (documented in the banner).
- No `shell: true` equivalents beyond the .bat itself, no admin rights, no global installs, no hard-coded user paths.
- Document it in `docs/RUNNING.md` §2 ("Double-click `Start-IT-Studio.bat`").

## Tests

- `scripts/dev/repo-layout.test.mjs` (node:test, run by the existing build/release node test command): asserts the moved files exist under `docs/`, none of them remain at the root, and `git grep` finds no reference to the old root paths.
- `Start-IT-Studio.bat` static checks in the same test: contains `cd /d "%~dp0"`, `npm run dev`, a `pause` on error, no absolute `C:\Users` path.

## Acceptance criteria

- [ ] Root lists only: `.claude/`, `apps/`, `config/`, `docs/`, `e2e/`, `scripts/`, `src/`, the tool files listed above, `AGENTS.md`, `CHANGELOG.md`, `Start-IT-Studio.bat` (plus ignored build/cache folders).
- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass. QA double-clicks the .bat and reaches *Ready*.

## Hand-back

Append `## Result` per AGENTS.md §3.
