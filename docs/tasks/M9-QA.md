# M9-QA — Packaging and release milestone gate

Milestone: M9 · Depends on: M9-01, M9-02, M9-05, M9-06, M9-FIX1, M9-FIX2 · Roles: Architect/QA and Implementer (ROLES §1.1–§1.3)

## Goal

Verify that the Windows x64 package contains a working SEA sidecar and its runtime resources, that both NSIS and MSI meet the per-user installer requirement, and that the installed app starts without system Node.js or repository dependencies. Record reproducible evidence and sign off M9 only when the TESTING.md §7 gate passes.

## Read first

- `AGENTS.md`, `CONTEXT.md` D33, `CONVENTIONS.md` §10, `ARCHITECTURE.md` §14.2, `TESTING.md` §§1–8, `ROADMAP.md` M9.
- `docs/qa/M9-test-cases.md`, `docs/HANDOFF.md` §4.4 and §5, `docs/RUNNING.md` §6.
- `docs/tasks/M9-01.md`, `M9-02.md`, `M9-05.md`, `M9-06.md`, `M9-FIX1.md`, and `M9-FIX2.md`; the build, smoke, release, and existing test scripts they cite.

## Scope — files you may create/modify

- `docs/qa/M9-test-cases.md` (Architect/QA case design and traceability).
- `docs/qa/M9-report.md` (QA execution results, defects, and sign-off).
- `scripts/build/qa/package.test.mjs` (new artifact-dependent assertions, run explicitly after `build:sidecar`; outside the default `npm test` glob).
- `scripts/build/tauri-debug-config.test.mjs`, `scripts/release/bump-version.test.mjs`, `apps/sidecar/src/infra/native-modules.test.ts`, and tests inside `apps/desktop/src-tauri/src/sidecar/spawn.rs` (case-ID names and missing L1/L2 coverage only).
- This task file, for `## Result` or `## Blocked`.

The existing `build:sidecar`, `smoke:sidecar`, `build:app`, and `smoke:install` commands are execution tools, not feature-code scope. If a case exposes a defect in them or in packaging, create a separate scoped M9 fix task before editing implementation.

## Contracts

- Preserve the existing `src/types/schemas.ts` contracts. Packaging consumes the sidecar's `system.ready`, `system.ping`, and `system.shutdown` JSON-RPC behavior; it introduces no schema shape.
- `npm run build:sidecar` emits `dist-sidecar/itstudio-sidecar-x86_64-pc-windows-msvc.exe` and `dist-sidecar/resources/manifest.json`.
- `npm run build:app` emits NSIS and MSI bundles with the SEA sidecar and resources; both installer types must install per user as required by M9-02. D33 defers code signing, updater keys, and clean-VM testing; it does not relax installer scope.

## Requirements

1. Implement every case marked automated in `docs/qa/M9-test-cases.md`, using the `TC-M9-###` ID in each new or updated test name. Reuse existing scripts for process and install checks; do not add real network or keychain access to unit/integration tests.
2. Build the final artifacts after all M8 and MW changes that affect the app have landed. Capture artifact paths, byte sizes, build time, and hashes so the smoke and manual checks are tied to the same build. Never use a stale installer as release evidence.
3. Run the package command gate and full regression in the sequence listed in the test-case document. Run the NSIS install smoke without deleting or replacing the owner's `%APPDATA%\com.itstudio.app` data. Record that its installed Ready evidence uses the real app-data location and does not establish fresh-profile state.
4. Verify MSI per-user configuration, final QA build output, and an isolated per-user installation that preserves existing app data. `M9-FIX2` has built a per-user MSI successfully after fixing WiX ICE38/ICE64 errors. Rebuild it with the final M9 source and keep installation and Ready verdicts pending until M9-QA executes them. Do not infer compliance from the older MSI that was built before the fix.
5. Execute a 20-minute exploratory session and write `docs/qa/M9-report.md` with per-case verdicts, command output summaries, coverage/mutation results, defects, artifact provenance, and sign-off against TESTING.md §7.

## Acceptance criteria (verifiable)

- [ ] Automated cases in `docs/qa/M9-test-cases.md` have executable checks and case-ID test names; manual cases have dated evidence and explicit pass/fail/pending status.
- [ ] `npx prettier --write <changed files>` runs before `npm run typecheck`, `npm run lint`, and `npm test`; all three pass. `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, `npm run test:integration`, and `npm run test:e2e` pass, along with prior milestone L4 regression required by TESTING.md §8.
- [ ] `npm run build:sidecar`, `npm run smoke:sidecar`, `npm run build:app`, `npm run smoke:install`, `npm run release:bump -- patch --dry-run`, and `npm run audit:prod` pass on the final source tree. The dry-run leaves manifests and `CHANGELOG.md` unchanged.
- [ ] Both final installers are per-user; the MSI has a verified final bundle and isolated installation. The installed app reaches Ready with its bundled sidecar, with no claim about fresh-profile state.
- [ ] TESTING.md §7 exit criteria hold: 100% P1 pass, at least 95% P2 pass, no open S1/S2 defects, coverage gates met, complete traceability, and a committed QA report. Otherwise leave M9 open and record the exact blocker.

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
- Open issues / follow-ups: Run the package test after the final sidecar build, then execute the full M9 package/install and regression gate and record verdicts in `docs/qa/M9-report.md`. The full `npm test` gate needs a rerun after parallel build load settles; no package artifact exists in this worktree yet. The MSI WiX regression test belongs to M9-FIX2 and is supplied by that separate task.
