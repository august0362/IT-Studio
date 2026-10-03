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
