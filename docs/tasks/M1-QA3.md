# M1-QA3 — Fix E2E test defects TC-M1-006 and TC-M1-007

Milestone: M1 · Depends on: M1-QA2 · Role: Implementer (ROLES §1.3) · **Deps pre-installed**

## Defects (test-side, found by QA on the real app)
1. **TC-M1-006** — after closing the window WebdriverIO reports "All window handles were removed, causing WebdriverIO to close the session" and the spec fails. The framework itself (or an `afterTest`/`afterEach` hook) still uses the session. Make this case independent: run it **last**, in its **own spec file** (`e2e/specs/m1/shutdown.spec.ts`), trigger close via `browser.closeWindow()` inside try/catch that tolerates the session-closed error, then assert from Node (process list) that `itstudio-desktop.exe` and the sidecar `node` process exit within 7 s. Ensure no WDIO hook touches the session after that.
2. **TC-M1-007** — fails with "The verification request did not start". Inspect why the scripted pending verification (`timeout` outcome) never shows its in-flight state in the real app (selector/state check, `ITSTUDIO_E2E` fixture wiring, the provider whose key must be saved first). Fix the test (and fixture wiring under `apps/sidecar/test/fixtures/**` if needed) so the request is provably in flight before the sidecar is killed, then assert the `[role="alert"]` "sidecar restarted" message.

## Scope
- `e2e/**`, `apps/sidecar/test/fixtures/**`

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0
- [ ] QA re-runs `npm run test:e2e` outside the sandbox: TC-M1-006 and TC-M1-007 pass

## Hand-back
Append `## Result` per AGENTS.md §3.
