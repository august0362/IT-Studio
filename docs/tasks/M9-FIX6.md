# M9-FIX6 — Honor an explicit MSI installation directory

Milestone: M9 · Depends on: M9-FIX2 and M9-QA installer smoke · Roles: Architect, Implementer, QA/Reviewer (ROLES.md §§1.1–1.3)

## Goal

Keep per-user MSI install location under the caller's control when `INSTALLDIR` is explicitly supplied, while retaining the previous-install path as the default for upgrades without an explicit location.

## Read first

- `AGENTS.md`, `CONTEXT.md` D33, `CONVENTIONS.md` §10, `ARCHITECTURE.md` §14.2, `TESTING.md` §7, `docs/qa/M9-test-cases.md` TC-M9-009/010.
- `apps/desktop/src-tauri/wix/main.wxs`, `scripts/build/wix-template.test.mjs`, `docs/tasks/M9-FIX2.md`.

## Scope — files you may create/modify

- `apps/desktop/src-tauri/wix/main.wxs` (MSI directory lookup/assignment only).
- `scripts/build/wix-template.test.mjs` (focused regression for directory precedence).
- This task file for `## Result` or `## Blocked`.

No package manifest, lockfile, schema, NSIS template, or generated bundle is in scope.

## Contracts

- MSI remains `InstallScope=perUser`, with files under a user-writable Local AppData directory and HKCU component KeyPaths. WebView2, sidecar/resources, shortcuts, and upgrade metadata remain present.
- An explicit `INSTALLDIR` passed on the MSI command line or selected in the installer UI takes precedence over registry discovery. Without an explicit choice, an existing current-user install path may be reused.

## Requirements

1. Move the two current HKCU RegistrySearch elements from the public `INSTALLDIR` property to a separate previous-path property. Assign the previous path to `INSTALLDIR` only when `INSTALLDIR` is unset, before directory costing and only once across UI/execute sequences.
2. Keep both NSIS default-value and MSI `InstallDir` registry searches, with the latter preferred if both exist. Preserve the original per-user directory fallback when neither exists.
3. Add an automated template regression showing the searches cannot directly overwrite `INSTALLDIR` and the conditional assignment honors an explicit value.
4. Record the M9-QA finding: after NSIS smoke uninstalled from a temporary directory, its HKCU path value remained; `msiexec /i` with a different explicit `INSTALLDIR` exited 0 but MSI AppSearch changed that property to the stale NSIS path. The resulting app reached Ready and uninstalled, but the requested directory was not used.

## Acceptance criteria

- [ ] Focused WiX template tests pass and demonstrate conditional path precedence.
- [ ] Final `npm run build:app` emits NSIS and MSI without ICE38/ICE64 or WiX errors.
- [ ] With the stale current-user NSIS path still present, a new isolated MSI install honors a different explicit Local AppData `INSTALLDIR`, reaches Ready with its bundled sidecar, and uninstall removes only that test installation.
- [ ] Scoped Prettier, typecheck, lint, and unit tests pass after merge; no dependency, schema, or toolchain change occurs.

## Out of scope

- Removing or editing the owner's registry values, changing the default product install location, or changing NSIS behavior.

## Role assignment and disjoint work

- Architect: writes this work order and documents the observed installer log/property transition.
- Implementer: edits only the WiX template and focused test in `C:/Users/admin/itstudio-wt/M9-FIX6`; its scope is disjoint from the M9-QA report and exploratory evidence.
- QA/Reviewer: validates against CONVENTIONS.md §10, builds the final installers, then checks the explicit-path MSI install/Ready/uninstall and the M9-QA source gates.

## Result

- Summary: Moved both HKCU path searches to `PREVIOUS_INSTALLDIR` and conditionally assign that path to `INSTALLDIR` only when no explicit install directory exists. `Sequence="first"` applies the default once for UI or silent execute. This addresses the M9-QA finding where a stale NSIS registry path overrode an explicit MSI install location.
- Files changed: `apps/desktop/src-tauri/wix/main.wxs`, `scripts/build/wix-template.test.mjs`, and this task file.
- Dependencies added (with reason): None.
- Decisions taken within scope: Kept the NSIS default-value search before the MSI `InstallDir` search so the MSI-specific value wins when both exist; retained the Local AppData directory fallback and all other installer elements.
- Open issues / follow-ups: Scoped Prettier, `npm run typecheck`, `npm run lint`, and the WiX template test (4/4) passed. The first full `npm test` run under concurrent QA load had three unrelated sidecar test timeouts or output timing failures and one LanceDB setup timeout; all four affected files passed on a serial rerun (33/33 tests). QA will rerun the full suite after landing, then build the final MSI and verify an explicit Local AppData `INSTALLDIR` against the stale HKCU path, Ready startup, and isolated uninstall. No installer was built or installed in this implementer worktree.
