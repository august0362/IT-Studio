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

## Result
- Summary: Made TC-M1-007 save the OpenAI key before verification and wait for the in-flight UI state before killing the sidecar; isolated TC-M1-006 in a final shutdown spec that checks process exit from Node after closing the window.
- Files changed: `e2e/specs/m1/startup.spec.ts`, `e2e/specs/m1/shutdown.spec.ts`, `e2e/wdio.conf.ts`, `docs/tasks/M1-QA3.md`.
- Dependencies added (with reason): None.
- Decisions taken within scope: Kept the existing 10-second scripted verifier timeout and E2E environment wiring; explicitly ordered the shutdown spec last.
- Open issues / follow-ups: QA must rerun `npm run test:e2e` outside the sandbox to verify TC-M1-006 and TC-M1-007 against the real app.

## QA (Claude)
- E2E on the real app: **8/8 pass** (TC-M1-001, 004, 006, 007, 030, 035, 040, 041). QA aligned TC-M1-035 with the in-app ConfirmDialog (written for native confirm) and made TC-M1-040 wait for dialog focus before pressing Esc (keys were sent before the dialog moved focus — test timing, not product).
