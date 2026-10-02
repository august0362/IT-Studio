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
