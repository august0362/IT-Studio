# M3-QA — Automate the M3 test-case specification

Milestone: M3 · Role: Implementer (ROLES §1.3) · **Deps pre-installed**

## Read first
- `AGENTS.md`, `TESTING.md`, **`docs/qa/M3-test-cases.md`** (your work order), existing tests under `apps/sidecar/src/**/*.test.ts` and `apps/sidecar/test/integration/{ledger,budget,pricing,pnl}.test.ts`

## Scope
- Tests only: `apps/sidecar/src/**/*.test.ts`, `apps/sidecar/test/integration/**`, `apps/sidecar/test/fixtures/**`. Production code **only** if a new test exposes a defect — then fix minimally and list it under *Decisions*.

## Requirements
1. Implement every case marked **new** and complete every **verify** / **→ add L3** item; use the case ID in the test name (`it('TC-M3-036 …')`).
2. Rename the duplicate ID: the FX test currently named "TC-M3-020 applies the FX override…" → `TC-M3-015`.
3. Reach the white-box gates in §2: `cost.ts`, `money.ts`, `budget-guard.ts` **100 % branches**; listed services ≥ 80 %.
4. No real network, no real keychain, no GUI/E2E runs (they open windows on the user's desktop).

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0; coverage gates met (report numbers); QA runs integration

## Hand-back
Append `## Result` per AGENTS.md §3 including a table: case ID → test file → status.
