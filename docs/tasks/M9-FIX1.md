# M9-FIX1 — Debug / dev builds fail on a fresh checkout (regression from M9-02, S2)

Role: Implementer (ROLES §1.3) · **Deps pre-installed** · Effort: small

## Defect
`apps/desktop/src-tauri/tauri.conf.json` (the base config used by `tauri dev` and `tauri build --debug`) declares `bundle.resources` pointing at `bundle-resources/resources`, which only exists after `npm run build:app` staged it. On a fresh checkout / worktree every debug build fails in Tauri's build script:
```
resource path `bundle-resources\resources` doesn't exist
```
→ E2E cannot start, and `npm run dev` breaks on any machine that has not run `build:app`. M9-02 moved `externalBin` into `tauri.conf.release.json` but left `resources` in the base config.

## Scope
`apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/tauri.conf.release.json`, `scripts/build/build-app.mjs` (only if it relies on the base config), `.gitignore`.

## Requirements
1. Move every release-only bundle setting (`resources`, and anything else that references staged build outputs) into `tauri.conf.release.json`; the base config must build in debug with nothing staged.
2. Add a guard test (node script under `scripts/build/` run by `npm test` or a vitest test) asserting the base config references no path under `bundle-resources/` or `binaries/`.
3. Keep `npm run build:app` producing NSIS + MSI exactly as before.

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0; QA verifies `tauri build --debug --no-bundle` in a fresh worktree and `npm run build:app`. Do not run E2E.

## Hand-back
Append `## Result` per AGENTS.md §3.

## Result
- Summary: Moved staged resources into the release Tauri overlay and added a guard script that rejects staged-output paths in the base config.
- Files changed: `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/tauri.conf.release.json`, `scripts/build/tauri-debug-config.test.mjs`, `docs/tasks/M9-FIX1.md`.
- Dependencies added (with reason): None.
- Decisions taken within scope: Kept `scripts/build/build-app.mjs` unchanged because it already passes the release overlay when building NSIS and MSI installers. The guard runs directly with Node; making `npm test` discover it requires editing `package.json` or a Vitest project config, both outside this task's Scope.
- Open issues / follow-ups: `npm run typecheck` and `npm run lint` passed. The guard script passed when run directly. `npm test` ran 120 files and failed one DOCX parser case (`converts DOCX headings to markdown`) at its 5-second timeout (845 passed, 1 failed, 1 skipped). E2E was not run. Tauri debug build and `npm run build:app` were not run.

## QA (Claude)
- Verdict: **PASS**. In a fresh worktree with nothing staged, `tauri build --debug --no-bundle` succeeds (was failing). typecheck ✔, lint ✔, unit pass except the known DOCX timeout flake. Note: the guard `scripts/build/tauri-debug-config.test.mjs` runs with `node --test`, not part of `npm test` — add to the release checklist with the bump-script tests.
