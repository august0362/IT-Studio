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

## Result
- Summary: Added the sidecar integration harness, scripted E2E composition root, WebdriverIO/tauri-driver suite, separate integration/E2E scripts, and RpcClient regression coverage. RpcClient branch coverage is 100%.
- Files changed: `apps/sidecar/test/integration/**`, `apps/sidecar/src/container.ts`, `apps/sidecar/src/main.ts`, `apps/desktop/src/rpc/rpc-client.ts`, `apps/desktop/src/rpc/rpc-client.test.tsx`, `e2e/**`, `package.json`, `package-lock.json`, `vitest.config.ts`, `eslint.config.js`.
- Dependencies added (with reason): `@wdio/cli`, `@wdio/local-runner`, `@wdio/mocha-framework`, `@wdio/spec-reporter`, `@wdio/types`, and `webdriverio` (all pinned to 9.32.0) for the requested WebdriverIO E2E runner and specs.
- Decisions taken within scope: `npm test` selects the three existing L1/L2 projects; L3 stays in `test:integration` so the normal test command remains separate. E2E skips with a clear message when `tauri-driver` or `msedgedriver` is unavailable.
- Automated test cases:
  - `TC-M1-001` — `e2e/specs/m1/startup.spec.mjs`
  - `TC-M1-002`, `TC-M1-003`, `TC-M1-007` — `apps/sidecar/test/integration/startup.test.ts`
  - `TC-M1-004`, `TC-M1-006`, `TC-M1-007` — `e2e/specs/m1/startup.spec.mjs`
  - `TC-M1-005` — existing Rust unit coverage in `apps/desktop/src-tauri/src/sidecar/mod.rs`
  - `TC-M1-010`–`TC-M1-016` — `apps/sidecar/test/integration/protocol.test.ts`
  - `TC-M1-020`–`TC-M1-025` — `apps/sidecar/test/integration/settings-projects.test.ts`
  - `TC-M1-030`, `TC-M1-035`, `TC-M1-040` — `e2e/specs/m1/api-keys.spec.mjs`
  - `TC-M1-031`–`TC-M1-034` — `apps/sidecar/test/integration/secrets.test.ts`
  - `TC-M1-036` — manual/opt-in Credential Manager case, as specified by QA
  - `TC-M1-041` — `e2e/specs/m1/fatal.spec.mjs`
- Verification: `npm run typecheck`, `npm run lint`, and `npm test` pass. RpcClient coverage run reports 100% branches. `npm run test:e2e` exits successfully with a skip because `msedgedriver` is unavailable. `npm run test:integration` is implemented but the sandbox blocks the spawned `tsx` process at `os.userInfo()` with `uv_os_get_passwd returned ENOMEM`; QA must rerun it outside the sandbox.
- Open issues / follow-ups: Run the integration suite and L4 suite in the QA environment with `tsx`, `tauri-driver`, and Edge WebDriver process access.

## Fix round 1 (QA)
QA re-ran outside the sandbox: typecheck ✔, lint ✔, unit ✔, RpcClient fix accepted (**BUG-M1-004, S1**: `paramsById` was never populated → every UI RPC call was sent without `params`; justified out-of-scope fix). Integration: **17/20 pass, 3 fail** — all are test defects:
1. **TC-M1-022** — response correlated by arrival order: got `id: 4` where `id: 1` expected. Harness `call()` must resolve only the response whose `id` equals the request id (map of pending ids), never "next line".
2. **TC-M1-014** — fixed 500 ms sleep before asserting the > 8 MiB line result. Replace sleeps with `waitFor(predicate, timeout 10 s)` polling on `stdoutLines`; assert `-32700` for the oversize line and a normal response for the following request.
3. **TC-M1-007** — `afterEach` hook times out (10 s) after the test killed the sidecar: `close()` must be idempotent and return immediately if the process already exited (check `exitCode`/`signalCode`, else SIGTERM → 3 s → SIGKILL).
4. **Default `npm test` must not run the `integration` project** (it spawns real processes, ~2 min). Exclude it from the root `vitest.config.ts` default projects; keep `npm run test:integration` and `test:all`.
5. Remove every fixed sleep in `apps/sidecar/test/integration/**` (use `waitFor`). Prove stability: run `npm run test:integration` 3 times consecutively outside sandbox is done by QA — inside the sandbox, ensure the tests at least typecheck/lint.
Append `## Result — fix round 1`.

## Result — fix round 1
- Summary: Kept integration response dispatch matched to pending requests by JSON-RPC id and corrected TC-M1-022 to compare settings results rather than response envelopes with different request ids. Made sidecar shutdown idempotent with SIGTERM/SIGKILL escalation, replaced TC-M1-014's fixed sleep with stdout polling, and excluded integration tests from the default Vitest projects.
- Files changed: `apps/sidecar/test/integration/harness.ts`, `apps/sidecar/test/integration/protocol.test.ts`, `apps/sidecar/test/integration/settings-projects.test.ts`, `vitest.config.ts`, `docs/tasks/M1-QA.md`.
- Dependencies added (with reason): None.
- Decisions taken within scope: `waitFor` polls every 20 ms and defaults to a 10 second timeout; sidecar shutdown waits up to 3 seconds after SIGTERM before sending SIGKILL.
- Open issues / follow-ups: `npm run test:integration` was not run in the sandbox; QA should run it three consecutive times outside the sandbox as specified. Typecheck, lint, and the default unit/component suite pass in the sandbox.

## QA (Claude) — partial sign-off of M1-QA
- **Merged now:** integration harness + 20 integration TCs (**20/20 pass, 3 consecutive runs**, outside sandbox), RpcClient BUG-M1-004 (S1) fix + regression tests (rpc-client 100 % branch), `ITSTUDIO_E2E` switches, default `npm test` excludes integration.
- QA tooling fixes applied: dedicated `vitest.integration.config.ts` (fix round had removed the integration project → `test:integration` could not run); `tsconfig.json` for `apps/sidecar/test` and `e2e` (ESLint default-project limit); `tauri-driver --native-driver` path.
- **Not done → follow-up `M1-QA2`:** strict typecheck of test code (`npm run typecheck:tests` currently fails: 4 errors) and an actual L4 E2E run.
