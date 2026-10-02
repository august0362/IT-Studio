# M7-QA — Automate the M7 test-case specification

Milestone: M7 · Role: Implementer (ROLES §1.3) · **Deps pre-installed** (`@vscode/test-electron` ~3.1)

## Read first
- `AGENTS.md`, `TESTING.md`, **`docs/qa/M7-test-cases.md`** (your work order), `apps/vscode-ext/src/**`, `apps/sidecar/src/services/{vscode-bridge,vscode-launcher}.ts`, `apps/sidecar/test/integration/vscode-bridge.test.ts`

## Scope
- Tests: `apps/vscode-ext/src/**/*.test.ts`, `apps/sidecar/src/services/vscode-*.test.ts`, `apps/sidecar/src/domain/code-cli.test.ts`, `apps/sidecar/test/integration/vscode-*.test.ts` (+ new files with that prefix). Other QA tasks edit M3 / RAG / pipeline tests in parallel — do not touch them.
- L4 harness (write, **do not run**): `apps/vscode-ext/test/e2e/**` using `@vscode/test-electron` (`runTests` with a temp workspace containing `.itstudio/session.json` that points to a test WebSocket server started by the harness), plus a root script `test:vscode-e2e` (scripts only). Cases TC-M7-050/051.
- Production code only if a new test exposes a defect — fix minimally, list under *Decisions*.

## Requirements
1. Implement every case marked **new** and complete **verify** items; case ID in the test name.
2. L3 cases use a real WebSocket client (`ws`) acting as the extension against the real sidecar bridge — never a real VS Code.
3. Gates per §2 (measure and report each module).
4. No real network, no GUI runs: do **not** execute `test:vscode-e2e` or the E2E suite (they open windows on the user's desktop).

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0; `npm run build -w itstudio-vscode` succeeds; gates reported; QA runs integration

## Hand-back
Append `## Result` per AGENTS.md §3 including a table: case ID → test file → status.

## Result
- Summary: Added M7 security, reconnect, malformed-message, pipeline-disconnect, launcher, extension action, diagnostics, and save-boundary coverage; added the opt-in VS Code E2E harness and `test:vscode-e2e` script. Fixed two boundary behaviors exposed by the cases: own writes remain suppressed at exactly 2,000 ms, and `autoLaunch: false` skips extension installation and process launch.
- Files changed: `apps/sidecar/src/domain/code-cli.test.ts`, `apps/sidecar/src/services/vscode-bridge.test.ts`, `apps/sidecar/src/services/vscode-launcher.test.ts`, `apps/sidecar/src/services/vscode-launcher.ts`, `apps/sidecar/src/services/vscode-session-file.test.ts`, `apps/sidecar/test/integration/vscode-bridge.test.ts`, `apps/vscode-ext/src/actions.test.ts`, `apps/vscode-ext/src/bridge.test.ts`, `apps/vscode-ext/src/diagnostics-push.test.ts`, `apps/vscode-ext/src/save-watcher.test.ts`, `apps/vscode-ext/src/save-watcher.ts`, `apps/vscode-ext/test/e2e/suite.cjs`, `apps/vscode-ext/test/e2e/run.mjs`, `package.json`, and this task file.
- Dependencies added (with reason): None; `@vscode/test-electron` was already installed in the workspace.
- Decisions taken within scope: The launcher does not inspect or install the extension when `autoLaunch` is disabled, matching TC-M7-044. The own-write suppression boundary is inclusive through 2,000 ms, matching TC-M7-022.
- Gates: `npm run typecheck` passed; `npm run lint` passed; `npm test` passed (107 files, 671 passed, 1 skipped). Targeted line coverage: extension `actions.ts` 98.07%, `bridge.ts` 97.70%, `diagnostics-push.ts` 90.90%, `save-watcher.ts` 100%, `session.ts` 100%; sidecar `vscode-bridge.ts` 93.98%, `vscode-launcher.ts` 92.78%, `code-cli.ts` 100%. All specified line gates met. The full instrumented coverage command timed out one unrelated desktop theme test; targeted M7 module coverage completed. L3 `npm run test:integration` was attempted but sidecar child processes failed at `tsx` startup with `uv_os_get_passwd returned ENOMEM`; the 68 integration failures include existing suites and the new M7 L3 cases. `npm run build -w itstudio-vscode` was attempted and esbuild reported access denied while resolving the extension entrypoint. Both require QA reruns outside this sandbox. The VS Code E2E suite and `test:vscode-e2e` were not run, as instructed.
- Open issues / follow-ups: QA should rerun L3 integration and the extension build outside the sandbox, then run TC-M7-050/051 in the approved batched GUI session. TC-M7-052 remains the specified manual VS Code check.

| Case ID | Test file | Status |
|---|---|---|
| TC-M7-001 | `apps/sidecar/test/integration/vscode-bridge.test.ts` | Implemented; L3 blocked by sandbox `tsx` startup failure |
| TC-M7-002 | `apps/sidecar/test/integration/vscode-bridge.test.ts`; `apps/sidecar/src/services/vscode-bridge.test.ts` | Implemented; L3 blocked; constant-time authentication path reviewed and wrong-token behavior covered |
| TC-M7-003 | `apps/sidecar/test/integration/vscode-bridge.test.ts`; `apps/sidecar/src/services/vscode-bridge.test.ts` | Implemented; L3 blocked; unit Origin rejection covered |
| TC-M7-004 | `apps/sidecar/test/integration/vscode-bridge.test.ts` | Implemented; L3 blocked by sandbox `tsx` startup failure |
| TC-M7-005 | `apps/sidecar/src/services/vscode-bridge.test.ts` | Unit timeout case passes |
| TC-M7-006 | `apps/sidecar/test/integration/vscode-bridge.test.ts` | Implemented; L3 blocked by sandbox `tsx` startup failure |
| TC-M7-007 | `apps/sidecar/test/integration/vscode-bridge.test.ts` | Implemented; L3 blocked by sandbox `tsx` startup failure |
| TC-M7-008 | `apps/sidecar/src/services/vscode-session-file.test.ts` | Unit idempotency and existing-entry cases pass |
| TC-M7-010 | `apps/vscode-ext/src/actions.test.ts` | Unit case passes |
| TC-M7-011 | `apps/vscode-ext/src/actions.test.ts` | Diff and LRU unit cases pass |
| TC-M7-012 | `apps/vscode-ext/src/actions.test.ts` | Commit and rollback unit cases pass |
| TC-M7-013 | `apps/vscode-ext/src/actions.test.ts` | Absolute, traversal, and escaping path cases pass |
| TC-M7-014 | `apps/vscode-ext/src/actions.test.ts` | Diagnostics mapping unit case passes |
| TC-M7-020 | `apps/vscode-ext/src/diagnostics-push.test.ts` | Debounce and cap unit cases pass |
| TC-M7-021 | `apps/vscode-ext/src/diagnostics-push.test.ts` | Disconnected unit case passes |
| TC-M7-022 | `apps/vscode-ext/src/save-watcher.test.ts` | Filtering and 2,000/2,001 ms boundary cases pass |
| TC-M7-023 | `apps/sidecar/test/integration/vscode-bridge.test.ts` | Implemented; L3 blocked by sandbox `tsx` startup failure |
| TC-M7-030 | `apps/sidecar/test/integration/vscode-bridge.test.ts` | Implemented; L3 blocked by sandbox `tsx` startup failure |
| TC-M7-031 | `apps/sidecar/test/integration/vscode-bridge.test.ts` | Implemented; L3 blocked by sandbox `tsx` startup failure |
| TC-M7-032 | `apps/sidecar/test/integration/vscode-bridge.test.ts` | Implemented; L3 blocked by sandbox `tsx` startup failure |
| TC-M7-040 | `apps/sidecar/src/domain/code-cli.test.ts` | Unit parser case passes |
| TC-M7-041 | `apps/sidecar/src/services/vscode-launcher.test.ts` | Resolution order and missing-installation cases pass |
| TC-M7-042 | `apps/sidecar/src/services/vscode-launcher.test.ts` | Missing, outdated, and matching-version cases pass |
| TC-M7-043 | `apps/sidecar/src/domain/code-cli.test.ts`; existing `apps/sidecar/src/infra/node-code-cli-runner.test.ts` | Allow-listed executable checks and existing invalid-argument/start-failure cases pass |
| TC-M7-044 | `apps/sidecar/src/services/vscode-launcher.test.ts` | `autoLaunch: false` skips install and launch |
| TC-M7-045 | `apps/vscode-ext/package.json` | Existing manual package check noted in the case specification; build attempt blocked by sandbox esbuild access error |
| TC-M7-050 | `apps/vscode-ext/test/e2e/suite.cjs`; `apps/vscode-ext/test/e2e/run.mjs` | Harness implemented; not run per instruction |
| TC-M7-051 | `apps/vscode-ext/test/e2e/suite.cjs`; `apps/vscode-ext/test/e2e/run.mjs` | Harness implemented; not run per instruction |
| TC-M7-052 | Manual QA | Manual case remains for the approved VS Code session |

## QA (Claude)
- Verdict: **PASS (L4 pending)**. Defects fixed by the new cases: own-write suppression inclusive at 2 000 ms; `autoLaunch:false` no longer installs the extension. After merging main: typecheck ✔, lint ✔, extension build ✔, 725 unit ✔, integration 83/83 (run 1); run 2 hit the known TC-M1-033 30 s timeout (4 sequential cold sidecar starts, PERF-01) — QA raised that test's budget to 90 s. L4 TC-M7-050/051 (`test:vscode-e2e`) and manual TC-M7-052 run in the batched E2E session.
