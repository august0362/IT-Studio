# M1-QA — Automate the M1 QA gate (integration + E2E harness)

Milestone: M1 · Depends on: M1-01…M1-07 · Role: Implementer (ROLES §1.3) · **Deps: allowed to add dev dependencies listed below** (this task owns root `package.json` / lockfile changes; no other task may run in parallel that edits them)

## Goal
Build the reusable L3 (sidecar integration) and L4 (Tauri E2E) test harnesses and automate every M1 test case marked `integration` / `e2e` in `docs/qa/M1-test-cases.md`.

## Read first
- `AGENTS.md`, `TESTING.md` (all), `docs/qa/M1-test-cases.md` (your work list), `ARCHITECTURE.md` §2–§3, existing `apps/sidecar/src/container.ts`, `apps/desktop/src-tauri/src/sidecar/**`, `apps/desktop/src/rpc/**`

## Scope — files you may create/modify
- `apps/sidecar/test/integration/**` (new), `apps/sidecar/src/container.ts` + `apps/sidecar/src/main.ts` (only to add the `ITSTUDIO_E2E` / `ITSTUDIO_E2E_CRASH_ON_START` switches)
- `e2e/**` (new, repo root: WebdriverIO config, specs, helpers)
- `apps/desktop/src/rpc/rpc-client.test.tsx` (missing branch cases only)
- root `package.json` (scripts + devDependencies), `package-lock.json`, `vitest.config.ts` (add an `integration` project), `eslint.config.js` (lint the new test folders)
- Dev deps allowed: `@wdio/cli`, `@wdio/local-runner`, `@wdio/mocha-framework`, `@wdio/spec-reporter`, `webdriverio`, `@wdio/types`; Rust tool `tauri-driver` is installed by QA, not by you (assume it is on PATH; skip L4 with a clear message if missing).

## Requirements
1. **`ITSTUDIO_E2E=1`** in the composition root: `MemorySecretStore`, fake provider-key verifier (scripted from `apps/sidecar/test/fixtures/verifier.json`), temp `ITSTUDIO_DATA_DIR` respected, no network. `ITSTUDIO_E2E_CRASH_ON_START=1`: exit(1) immediately after start (for TC-M1-041).
2. **L3 harness** `apps/sidecar/test/integration/harness.ts`: spawns `node --import tsx apps/sidecar/src/main.ts` with a fresh temp data dir, typed `call(method, params)`, `notifications` stream, raw `writeLine`, `kill()`, `restart()`, captures stderr. Vitest project `integration` (`npm run test:integration`), sequential, 30 s timeout per test.
3. **L4 harness** `e2e/wdio.conf.ts`: builds the debug app (`npm run tauri -w @itstudio/desktop -- build --debug --no-bundle`) once, launches via `tauri-driver`, env `ITSTUDIO_E2E=1`; helpers for status bar, nav, API Keys page; `npm run test:e2e`.
4. Implement every TC in `docs/qa/M1-test-cases.md` whose *Auto?* column is `integration` or `e2e`; test titles start with the TC id. Cases already covered by existing unit tests (TC-M1-005, TC-M1-007 L2) need no duplicate.
5. Add the missing branch tests for `rpc-client.ts` (lines 63, 131, 196 per QA) → 100 % branch coverage for that file.
6. Root scripts: `test:integration`, `test:e2e`, `test:all` (= `test` + `test:integration` + `test:e2e`).

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0
- [ ] `npm run test:integration` passes all M1 integration TCs
- [ ] `npm run test:e2e` passes all M1 e2e TCs, or — if `tauri-driver` / WebDriver is unavailable in the sandbox — is skipped with a clear message (QA runs it outside the sandbox)
- [ ] `rpc-client.ts` branch coverage 100 %

## Hand-back
Append `## Result` per AGENTS.md §3, listing each TC id and its automated test path.
