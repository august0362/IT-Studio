# M9-QA — Packaging and release milestone gate

Milestone: M9 · Depends on: M9-01, M9-02, M9-05, M9-06, M9-FIX1, M9-FIX2, M9-FIX6, M9-FIX7 · Roles: Architect/QA and Implementer (ROLES §1.1–§1.3)

## Goal

Verify that the Windows x64 package contains a working SEA sidecar and its runtime resources, that both NSIS and MSI meet the per-user installer requirement, and that the installed app starts without system Node.js or repository dependencies. Record reproducible evidence and sign off M9 only when the ../../../TESTING.md §7 gate passes.

## Read first

- `AGENTS.md`, `../../../CONTEXT.md` D33, `../../../CONVENTIONS.md` §10, `../../../ARCHITECTURE.md` §14.2, `../../../TESTING.md` §§1–8, `../../../ROADMAP.md` M9.
- `../../../qa/archive/M9-test-cases.md`, `docs/HANDOFF.md` §4.4 and §5, `docs/RUNNING.md` §6.
- `M9-01.md`, `M9-02.md`, `M9-05.md`, `M9-06.md`, `M9-FIX1.md`, and `M9-FIX2.md`; the build, smoke, release, and existing test scripts they cite.

## Scope — files you may create/modify

- `../../../qa/archive/M9-test-cases.md` (Architect/QA case design and traceability).
- `../../../qa/archive/M9-report.md` (QA execution results, defects, and sign-off).
- `docs/RUNNING.md` (remove stale M8/MW known-limitations statements during the manual release-path review).
- `docs/HANDOFF.md` (update the stale M9-QA and v1 status after the gate, while preserving the owner stop before v2).
- `scripts/build/qa/package.test.mjs` (new artifact-dependent assertions, run explicitly after `build:sidecar`; outside the default `npm test` glob).
- `scripts/build/tauri-debug-config.test.mjs`, `scripts/release/bump-version.test.mjs`, `apps/sidecar/src/infra/native-modules.test.ts`, and tests inside `apps/desktop/src-tauri/src/sidecar/spawn.rs` (case-ID names and missing L1/L2 coverage only).
- This task file, for `## Result` or `## Blocked`.

The existing `build:sidecar`, `smoke:sidecar`, `build:app`, and `smoke:install` commands are execution tools, not feature-code scope. If a case exposes a defect in them or in packaging, create a separate scoped M9 fix task before editing implementation.

## Contracts

- Preserve the existing `src/types/schemas.ts` contracts. Packaging consumes the sidecar's `system.ready`, `system.ping`, and `system.shutdown` JSON-RPC behavior; it introduces no schema shape.
- `npm run build:sidecar` emits `dist-sidecar/itstudio-sidecar-x86_64-pc-windows-msvc.exe` and `dist-sidecar/resources/manifest.json`.
- `npm run build:app` emits NSIS and MSI bundles with the SEA sidecar and resources; both installer types must install per user as required by M9-02. D33 defers code signing, updater keys, and clean-VM testing; it does not relax installer scope.

## Requirements

1. Implement every case marked automated in `../../../qa/archive/M9-test-cases.md`, using the `TC-M9-###` ID in each new or updated test name. Reuse existing scripts for process and install checks; do not add real network or keychain access to unit/integration tests.
2. Build the final artifacts after all M8 and MW changes that affect the app have landed. Capture artifact paths, byte sizes, build time, and hashes so the smoke and manual checks are tied to the same build. Never use a stale installer as release evidence.
3. Run the package command gate and full regression in the sequence listed in the test-case document. Run the NSIS install smoke without deleting or replacing the owner's `%APPDATA%\com.itstudio.app` data. Record that its installed Ready evidence uses the real app-data location and does not establish fresh-profile state.
4. Verify MSI per-user configuration, final QA build output, and an isolated per-user installation that preserves existing app data. `M9-FIX2` has built a per-user MSI successfully after fixing WiX ICE38/ICE64 errors. Rebuild it with the final M9 source and keep installation and Ready verdicts pending until M9-QA executes them. Do not infer compliance from the older MSI that was built before the fix.
5. Execute a 20-minute exploratory session and write `../../../qa/archive/M9-report.md` with per-case verdicts, command output summaries, coverage/mutation results, defects, artifact provenance, and sign-off against ../../../TESTING.md §7.
6. Keep the release guide's known-limitations list aligned with the completed M8 image generation and MW Workflow milestones; do not change release policy or product behavior.
7. After the gate, align `docs/HANDOFF.md` with the actual M9 result and remaining owner decision; remove the claim that M9-QA has not started.

## Acceptance criteria (verifiable)

- [ ] Automated cases in `../../../qa/archive/M9-test-cases.md` have executable checks and case-ID test names; manual cases have dated evidence and explicit pass/fail/pending status.
- [ ] `npx prettier --write <changed files>` runs before `npm run typecheck`, `npm run lint`, and `npm test`; all three pass. `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, `npm run test:integration`, and `npm run test:e2e` pass, along with prior milestone L4 regression required by ../../../TESTING.md §8.
- [ ] `npm run build:sidecar`, `npm run smoke:sidecar`, `npm run build:app`, `npm run smoke:install`, `npm run release:bump -- patch --dry-run`, and `npm run audit:prod` pass on the final source tree. The dry-run leaves manifests and `CHANGELOG.md` unchanged.
- [ ] Both final installers are per-user; the MSI has a verified final bundle and isolated installation. The installed app reaches Ready with its bundled sidecar, with no claim about fresh-profile state.
- [ ] ../../../TESTING.md §7 exit criteria hold: 100% P1 pass, at least 95% P2 pass, no open S1/S2 defects, coverage gates met, complete traceability, and a committed QA report. Otherwise leave M9 open and record the exact blocker.
- [ ] `docs/HANDOFF.md` reflects the executed M9-QA status and the owner's required go-ahead before v2.

## Out of scope

- Changing product decisions, schema shapes, installer behavior, signing/updater setup, or the toolchain in this QA task.
- A clean-VM test, Authenticode signing, or an automatic update-flow test (D33 and ROADMAP M9-04).
- Deleting or replacing the owner's existing app-data directory; isolated installer checks must preserve it.

## Hand-back

Append `## Result` per AGENTS.md §3 with case verdicts, artifact provenance, verification commands, and open issues. If a required package or test gate remains blocked, append `## Blocked` with the exact failing command, evidence, and the decision or environment change required.

## Result (automated test implementation)

- Summary: Added executable TC-M9-001 and TC-M9-002 post-build checks for SEA resource integrity and missing-native-module startup failure. Added TC-M9-002 native development resolution/error checks, TC-M9-004 debug-config guard names and negative fixtures, and TC-M9-011 version dry-run/no-write and rejection fixtures.
- Files changed: `scripts/build/qa/package.test.mjs` (new), `scripts/build/tauri-debug-config.test.mjs`, `scripts/release/bump-version.test.mjs`, `apps/sidecar/src/infra/native-modules.test.ts`, and this task file.
- Dependencies added (with reason): None.
- Decisions taken within scope: The package test stays outside the default `npm test` glob and uses an isolated copied executable and copied fixture resource for destructive negative checks. It requires a final `dist-sidecar` build before explicit execution with `node --test scripts/build/qa/package.test.mjs`.
- Verification: `npx prettier --write` on the four test files passed; `npm run typecheck` and `npm run lint` passed. Focused `node --test scripts/release/bump-version.test.mjs scripts/build/tauri-debug-config.test.mjs` passed (9/9); `node --check scripts/build/qa/package.test.mjs` passed. In the full `npm test` run, 920 tests passed and one skipped; three unrelated existing tests failed while the concurrent MSI build was active: `TC-MW-009` ChatPage and CodePage deep-link tests, and the PDF parser's 5-second timeout. The new native-module tests passed.
- Open issues / follow-ups: Run the package test after the final sidecar build, then execute the full M9 package/install and regression gate and record verdicts in `../../../qa/archive/M9-report.md`. The full `npm test` gate needs a rerun after parallel build load settles; no package artifact exists in this worktree yet. The MSI WiX regression test belongs to M9-FIX2 and is supplied by that separate task.

## Blocked — final installer rebuild (2026-10-11; resolved 2026-10-14)

- Blocker: The final-source `npm run build:app` on revision `9dfada7b2cdfc5f7e5dffb2d00c3568772a852d3` exited 1 at the MSI bundling step. After compiling the release app and running NSIS packaging, Tauri attempted to download the Microsoft WebView2 bootstrapper and reported `failed to bundle project: timeout: global`.
- Tried: Completed one full final-source build attempt (16:06:18–16:14:05 UTC+07:00). No final installer pair or hashes are accepted from this failed attempt. Do not use stale pre-fix artifacts as final evidence.
- Passed since the earlier automated-test implementation result: typecheck, lint, 933 Vitest + 15 Node tests (one intentional skip), Cargo formatting and 16 Rust tests, 114 integration tests, full L4 E2E (14 specs/45 tests), overall statement coverage 85.55%, domain branch coverage 97.01%, package tests 3/3, and three warm sidecar smoke runs (452/427/528 ms). `TC-M9-015` passes in focused component and GUI checks.
- Resolution: `npm run build:app` succeeded on `ade1580ff20cb48786688aed1a884e7901b20ca5`; WebView2 bootstrapper download, NSIS, and MSI bundling completed. Final artifact sizes and hashes, install smokes, and logs are recorded in `../../../qa/archive/M9-report.md`.
- Remaining: Complete the main-branch `npm run test:all` gate and any remaining ../../../TESTING.md §7 checks before M9 sign-off.

## Result — final installer verification (2026-10-14)

- Summary: The final app build and both installer smoke paths completed successfully. The MSI installation reached Windows Installer context `MSIINSTALLCONTEXT_USERUNMANAGED` (numeric value 2) for the current user's SID, as reported by `MsiEnumProductsExW`; it was not present in the user-managed context. The HKLM uninstall ARP entry alone does not indicate a per-machine Windows Installer context. The files were installed under the explicit QA-only LocalAppData path, the bundled sidecar reached Ready, and uninstall removed the exact test product and directory.
- NSIS: `npm run smoke:install` exited 0 with all 7 checks passing. The smoke-installed app reached Ready with the bundled sidecar, used the real `%APPDATA%\com.itstudio.app` location, and was silently uninstalled from its temporary install directory.
- MSI: Final MSI SHA-256 `66B1EC7D957208A8EE064D94708240A4459FB467C170400849A378A2423AB6FE`; explicit `INSTALLDIR` under `%LOCALAPPDATA%` prevailed over the stale NSIS `PREVIOUS_INSTALLDIR`; Ready was observed with `itstudio-sidecar.exe` from that install. The product was uninstalled; `MsiEnumProductsExW` then returned `ERROR_NO_MORE_ITEMS` for the current user's unmanaged context, both HKCU/HKLM uninstall entries and the test install directory were absent.
- Existing app data: `itstudio.db` remained 94,208 bytes with its original 2026-10-02 timestamp. Startup caused only expected log/WAL/SHM activity; the app-data directory was not deleted or replaced.
- Artifacts: SEA 96,274,432 bytes, SHA-256 `EDF5FEE2F95705F50DFB039A5B0501F9785A483499BBD76CDBB88C703908054E`; NSIS 93,283,698 bytes, SHA-256 `1D2D7F06EFA98292641C93E5E0F7E8A276D23847E03E085797ED9653A6921A93`; MSI 147,797,076 bytes, SHA-256 `66B1EC7D957208A8EE064D94708240A4459FB467C170400849A378A2423AB6FE`.
- Evidence logs: `.npm-cache/m9-smoke-install-20261014.log`, `.npm-cache/m9-tc-m9-010-install.log`, `.npm-cache/m9-tc-m9-010-uninstall.log`, `.npm-cache/m9-tc-m9-010-context-install.log`, and `.npm-cache/m9-tc-m9-010-context-uninstall.log` in this worktree.
- Files changed: `M9-QA.md` and `../../../qa/archive/M9-report.md`; the app build also regenerated the already-modified `apps/desktop/src-tauri/icons/icon.icns`, which was left untouched.
- Dependencies added (with reason): None.
- Decisions taken within scope: Classified MSI scope from `MsiEnumProductsExW` (`MSIINSTALLCONTEXT_USERUNMANAGED`, value 2) rather than from the HKLM ARP uninstall key alone.
- Verification: `npx prettier --write M9-QA.md ../../../qa/archive/M9-report.md`, `npm run typecheck`, and `npm run lint` passed. `npm run test:all` exited 0 on this QA branch: 933 Vitest passed and 1 skipped, 15 Node tests passed, 114 integration tests passed, and 14 E2E specs / 45 tests passed. Log: `.npm-cache/m9-test-all-20261014.log`.
- Open issues / follow-ups: M9-QA remains in progress until the Architect lands the task branches, reruns `npm run test:all` on main, and verifies all ../../../TESTING.md §7 exit criteria. No installer defect/fix task is indicated by the HKLM ARP entry; no installer implementation was changed in this QA task.

## Result (main regression continuation — 2026-10-14)

- Summary: Rebuilt the debug desktop app and completed the requested main-branch regression gate after the M8, MW, and M9-FIX6/FIX7 changes.
- Files changed: `../../../qa/archive/M9-report.md`; this task file. Build outputs and the ignored `.npm-cache/m9-test-all-main-20261014.log` were generated; no application source was edited.
- Dependencies added (with reason): None.
- Decisions taken within scope: Retained an in-progress M9 verdict until the QA task branch and report are reviewed and integrated.
- Verification: On `main`, `npm run typecheck` passed; `npm run lint` passed; `npm run test:all` exited 0 with 932 Vitest tests passed and 1 skipped, 12 Node tests passed, 114 integration tests passed, and 14 E2E specs / 45 cases passed. The E2E suite used the rebuilt debug app from `npm run tauri -w @itstudio/desktop -- build --debug --no-bundle`.
- Open issues / follow-ups: Architect review/integration is still required before the M9 QA report can be committed or M9 can be signed off. Review the branch comparison before landing: `task/M9-QA` removes `../../../diagram.png` relative to main, while main has an existing user modification to that file. Preserve that user file during integration. No commit, merge, or worktree removal was performed.
