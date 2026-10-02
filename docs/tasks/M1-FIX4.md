# M1-FIX4 — Sidecar must shut down when stdin closes (BUG-M7-001, S2)

Milestone: M1 (regression from M7-02) · Role: Implementer (ROLES §1.3) · **Deps pre-installed**

## Defect (found by QA during M4-01 E2E)
When the desktop process dies without sending `system.shutdown` (crash, kill, WebDriver session end), the sidecar's stdin reaches EOF but `LineTransport` only flushes its buffer (`apps/sidecar/src/rpc/line-transport.ts` `'end'` handler). Before M7-02 the event loop then emptied and Node exited by itself; since the VS Code bridge keeps a listening WebSocket server once a project is active, the sidecar now **stays alive as an orphan** holding the bridge port, the SQLite file and `.itstudio/session.json`.
Repro: E2E `shell.spec.ts` (creates + activates a project) followed by `shutdown.spec.ts` → orphan `node …sidecar/src/main.ts` with a dead parent survives until the run ends; `TC-M1-006` then fails because `sidecarPid()` picks the orphan.

## Read first
- `AGENTS.md`, `ARCHITECTURE.md` §2.3 (supervision / shutdown), `apps/sidecar/src/{main,container}.ts`, `rpc/line-transport.ts`, `services/system-service.ts`, `e2e/helpers/ui.ts`, `e2e/specs/m1/shutdown.spec.ts`

## Scope
- `apps/sidecar/src/rpc/line-transport.ts` (+ test)
- `apps/sidecar/src/services/system-service.ts` (+ test)
- `apps/sidecar/src/container.ts` — **only** the wiring of the stdin-EOF callback to the shutdown (another task edits this file in parallel; keep the diff to a few lines)
- `apps/sidecar/test/integration/shutdown.test.ts` (new)
- `e2e/helpers/ui.ts`

## Requirements
1. `LineTransport` accepts an optional `onEnd` callback, called exactly once after the final buffered line is processed when the input ends (or emits `close`).
2. `SystemService` exposes `shutdown(reason: 'rpc' | 'stdin_closed')`; it is idempotent (concurrent/repeated calls share one run), logs `shutdown requested` with `reason`, runs all hooks (a throwing/rejecting hook is logged and does not stop the others), logs `sidecar exiting`, exits 0. A hard deadline of 3 s (injectable timers) forces `exit(0)` with a warning if hooks hang. `system.shutdown` RPC uses `reason: 'rpc'`.
3. Container wires `transport onEnd → service.shutdown('stdin_closed')`.
4. E2E helper `sidecarPid()` returns the sidecar whose `ParentProcessId` is a **running** `itstudio-desktop.exe` (most recently started one if several); throw if none. Do not change test expectations in specs.

## Tests
- Unit: `onEnd` fires once (end and close both emitted), after the last partial line is processed; shutdown idempotency, hook failure isolation, deadline forces exit, reason logged.
- Integration `TC-M1-020`: spawn the real sidecar (`node --import tsx src/main.ts` the way existing integration harness does, temp `ITSTUDIO_DATA_DIR`), `project.create` + `project.setActive` (bridge listening), then close the child's stdin without calling `system.shutdown` → process exits with code 0 within 3 s and the bridge port is no longer accepting connections.

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0; QA runs integration and the full E2E suite (TC-M1-006 green after `shell.spec.ts`)

## Hand-back
Append `## Result` per AGENTS.md §3.

## Result
- Summary: Added once-only stdin EOF/close shutdown handling after pending RPC lines finish; made shutdown idempotent with isolated hook failures, a 3 s injectable deadline, reason logging, and exit logging; wired stdin EOF to shutdown and updated E2E sidecar PID selection to require a running desktop parent.
- Files changed: `apps/sidecar/src/rpc/line-transport.ts`, `apps/sidecar/src/rpc/line-transport.test.ts`, `apps/sidecar/src/services/system-service.ts`, `apps/sidecar/src/services/system-service.test.ts`, `apps/sidecar/src/container.ts`, `apps/sidecar/test/integration/shutdown.test.ts`, `e2e/helpers/ui.ts`, `docs/tasks/M1-FIX4.md`.
- Dependencies added (with reason): None.
- Decisions taken within scope: EOF and close share a guarded finish path; shutdown hooks run independently so one failure cannot prevent other hooks; the integration case directly spawns the sidecar to exercise actual stdin closure and bridge teardown.
- Open issues / follow-ups: `npm run typecheck`, `npm run lint`, and `npm test` pass (509 passed, 1 skipped). The new integration test and the broader integration suite cannot start sidecar child processes in this sandbox: Node `tsx` fails in `os.userInfo()` with `uv_os_get_passwd` / `ENOMEM`, a documented sandbox limit. QA should rerun integration and full E2E outside the sandbox.

## QA (Claude)
- Verdict: **PASS**. typecheck ✔, lint ✔, 509 unit ✔, integration 52/52 ×2 incl. new TC-M1-020 (stdin closed with an active bridge → exit 0 within 3 s). Container diff limited to the EOF wiring. Full E2E re-run in the M4-01 worktree after merge (TC-M1-006 after `shell.spec.ts`).
