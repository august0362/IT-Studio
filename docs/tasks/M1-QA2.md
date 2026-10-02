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
