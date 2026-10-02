# M4-QA — Automate the M4 test-case specification

Milestone: M4 · Role: Implementer (ROLES §1.3) · **Deps pre-installed**

## Read first
- `AGENTS.md`, `TESTING.md`, **`docs/qa/M4-test-cases.md`** (your work order), `apps/desktop/src/**`, `e2e/**`

## Scope
- Tests: `apps/desktop/src/**/*.test.{ts,tsx}`, `e2e/specs/m4/**`, `e2e/helpers/**`, `e2e/wdio.conf.ts` (per-spec env for scripted LLM / per-model scripts, see TC-M4-022/023), `apps/desktop/src/i18n/{en,vi}.json` (remove unused keys only). Other QA tasks edit sidecar tests in parallel — do not touch them.
- Production code only if a new test exposes a defect — fix minimally, list under *Decisions*.

## Requirements
1. Implement every case marked **new**, complete **verify** items, fix the flaky TC-M4-004 timeout; case ID in the test name.
2. Write all L4 cases (WebdriverIO) but **do not run E2E** — QA runs them in one batched session with the user's permission.
3. If a per-model LLM script is needed for E2E (fallback badge / modal), wire it through the existing `ITSTUDIO_E2E_LLM_SCRIPT` env and a fixture under `e2e/fixtures/**`, set per spec without restarting other specs' drivers.
4. Measure and report the §2 targets.

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0; `npm run vite:build -w @itstudio/desktop` succeeds; targets reported

## Hand-back
Append `## Result` per AGENTS.md §3 including a table: case ID → test file → status.
