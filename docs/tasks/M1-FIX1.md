# M1-FIX1 — Fix flaky RpcServer concurrency test (BUG-M1-001)

Milestone: M1 · Depends on: M1-02 · Role: Implementer (ROLES §1.3) · **Deps pre-installed**

## Defect
**BUG-M1-001** (S3, test defect) — `apps/sidecar/src/rpc/rpc-server.test.ts` › "keeps concurrent request ids and forwards notifications" fails ~1 in 8 full-suite runs: `expected [1, 2] to deeply equal [2, 1]`. The test forces completion order with real timers (`setTimeout` 5 ms vs 0 ms); under CPU load the order inverts. Product behaviour (each response carries its own request id) is correct.

## Scope
- `apps/sidecar/src/rpc/rpc-server.test.ts` only (+ append Result to this file).

## Requirements
1. Make completion order deterministic with manually resolved deferred promises (resolve request 2's handler first, then request 1's) — no real timers, no sleeps.
2. Assert id ↔ result pairing explicitly (each response's `result.version` equals `String(id)`), not just ordering.
3. Keep the notification-forwarding assertion; replace `setTimeout(…, 0)` waits with awaiting the relevant promises / `vi.waitFor`.
4. Prove stability: run `npx vitest run apps/sidecar/src/rpc/rpc-server.test.ts --repeat 50` (or a loop) — 0 failures; state the command and result in `## Result`.

## Acceptance criteria
- [ ] Test deterministic (50/50 passes); `npm run typecheck && npm run lint && npm test` exit 0

## Hand-back
Append `## Result` per AGENTS.md §3.
