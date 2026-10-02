# M1-QA2 — Strictly typed test code + runnable L4 E2E suite

Milestone: M1 · Depends on: M1-QA · Role: Implementer (ROLES §1.3) · **Deps pre-installed**

## Goal
Test code is held to the same strict TypeScript standard as product code, and the M1 E2E specs actually run against the real Tauri app.

## Read first
- `AGENTS.md`, `TESTING.md` §1–§2 (E2E drivers), `docs/qa/M1-test-cases.md`, `docs/tasks/M1-QA.md` (QA sign-off notes)

## Scope
- `apps/sidecar/test/**`, `e2e/**`, root `package.json` (scripts only)

## Requirements
1. `npm run typecheck:tests` must pass. Current errors: `harness.ts:95` (response object vs `RpcResponse` under `exactOptionalPropertyTypes` — validate/narrow the parsed JSON instead of passing an optional `id`), `protocol.test.ts:23` (`sidecar` possibly undefined — use a local const), `e2e/wdio.conf.ts` capabilities typing (`browserName: 'wry'` + `tauri:options.application` — type the capability object correctly for WebdriverIO 9, e.g. via `@wdio/types` `Capabilities.RequestedStandaloneCapabilities` with a local `TauriCapabilities` extension; no `any`). Then add `typecheck:tests` to the root `typecheck` script.
2. Convert `e2e/specs/**/*.spec.mjs` to TypeScript (`.spec.ts`) so they are typechecked and linted.
3. `npm run test:e2e` must build the debug app if missing, start `tauri-driver --native-driver <ITSTUDIO_MSEDGEDRIVER>` (default `C:/Users/admin/.itstudio-tools/msedgedriver.exe`), run all M1 e2e specs, and stop the driver. Keep the clear skip message when drivers are missing.
4. Your sandbox likely cannot run E2E; implement carefully — QA runs it outside the sandbox.

## Acceptance criteria
- [ ] `npm run typecheck` (now including tests) && `npm run lint` && `npm test` exit 0
- [ ] `npm run test:e2e` passes outside the sandbox (QA verifies)

## Hand-back
Append `## Result` per AGENTS.md §3.

## Result
- Summary: Added `typecheck:tests` to the root typecheck, narrowed integration RPC responses through Zod, fixed the protocol test's sidecar narrowing, converted all M1 E2E specs and their helper to TypeScript, and updated WDIO to select `.spec.ts` files with typed Tauri capabilities. The E2E config builds the debug app only when absent, launches tauri-driver with the configured/default Edge WebDriver path, and stops drivers in `onComplete`.
- Files changed: `apps/sidecar/test/integration/harness.ts`, `apps/sidecar/test/integration/protocol.test.ts`, `e2e/**` (renamed the three specs and helper from `.mjs` to `.ts`), `package.json`, `docs/tasks/M1-QA2.md`.
- Dependencies added (with reason): None.
- Decisions taken within scope: Added DOM library types for browser E2E specs. Kept the secret scan comprehensive while filtering deleted tracked paths and the scanner's designated fixture directory; the existing scanner otherwise fails on renamed, unstaged files.
- Open issues / follow-ups: `npm run typecheck`, `npm run lint`, and `npm test` pass (275 tests passed, 1 skipped). `npm run test:e2e` reaches WDIO, but the sandbox blocks its `tsx` loader at `os.userInfo()` (`uv_os_get_passwd returned ENOMEM`); QA must run the L4 suite outside the sandbox to verify the real Tauri app.

## Fix round 1 (QA) — E2E executed by QA on the real app
QA fixes applied first: WDIO `specs` path was relative to the wrong dir (now `./specs/**/*.spec.ts`); two tauri-drivers collided on native port 4445 (now `--native-port` 4454/4455). E2E now runs: **4 pass** (TC-M1-001, 004, 030, 035), **4 fail**. Investigate each; decide test defect vs product defect; fix in Scope (`e2e/**`, plus the product files listed below if it is a product defect) and explain in Result:
1. **TC-M1-040** keyboard flow: after typing a key and pressing **Enter**, chip still `Not set`. M1-07 requires "Enter saves" → check `ApiKeysPage.tsx` form submit on Enter (product defect likely; you may edit `apps/desktop/src/features/settings/api-keys/**`). Add a component test for Enter-to-save.
2. **TC-M1-007** UI request interrupted by crash: no `[role="alert"]` appears. Expected (TESTING/ARCH §2.3): the pending call rejects with "sidecar restarted" and the page shows the error. Check ApiKeysPage error rendering for rejected mutations (product defect likely; same scope). Add a component test.
3. **TC-M1-041** fatal banner: "invalid session id" while waiting ~31 s of restart backoff. Raise the spec's waitUntil timeout to ≥ 60 s and the WDIO session/command timeouts accordingly; verify the banner selector exists in `StatusBar.tsx`.
4. **TC-M1-006** graceful close: WebDriver loses all window handles on close (expected). Rewrite: trigger close, then assert via Node (`tasklist` / process check) that `itstudio-desktop.exe` and the sidecar node process exit within 7 s; do not use the dead session.
You cannot run E2E in the sandbox — make changes carefully; QA re-runs `npm run test:e2e`. Append `## Result — fix round 1`.

## Result — fix round 1
- Summary: Kept QA's corrected WDIO specs path and separate native-driver ports. TC-M1-040 now waits for Enter-to-save and has component coverage for form submission. TC-M1-007 uses a deliberately pending verifier request so killing the sidecar exercises rejected-mutation alert rendering, with a component regression test. TC-M1-041 has 70-second banner wait and longer WDIO command/session timeouts; `StatusBar.tsx` already renders the fatal banner as `footer[role="alert"]`. TC-M1-006 checks desktop and sidecar process exit from Node within 7 seconds after closing the window, without further WebDriver calls.
- Files changed: `apps/desktop/src/features/settings/api-keys/ApiKeysPage.test.tsx`, `e2e/helpers/ui.ts`, `e2e/specs/m1/api-keys.spec.ts`, `e2e/specs/m1/fatal.spec.ts`, `e2e/specs/m1/startup.spec.ts`, `e2e/wdio.conf.ts`, `docs/tasks/M1-QA2.md`.
- Dependencies added (with reason): None.
- Decisions taken within scope: E2E verifier requests use the existing scripted `timeout` outcome to create a deterministic in-flight request for crash coverage.
- Open issues / follow-ups: `npm run typecheck`, `npm run lint`, and `npm test` pass (278 passed, 1 skipped). L4 E2E was not run in the sandbox; QA should rerun `npm run test:e2e` outside the sandbox.

## QA (Claude)
- E2E executed by QA on the real app after fix round 1: **5/8 pass** (TC-M1-001, 004, 030, 035, 041). QA infra fixes: specs path, native-port collision.
- TC-M1-040 → **product defect BUG-M1-005**: Delete uses native `window.confirm`, which Esc does not cancel under WebView2 (key deleted). Follow-up `M1-FIX3`.
- TC-M1-006 (session used after window close) and TC-M1-007 ("verification request did not start") → **test defects**. Follow-up `M1-QA3`.
- Merged: strictly typed test code (`typecheck` now includes tests), TS E2E specs, runnable `test:e2e`.
