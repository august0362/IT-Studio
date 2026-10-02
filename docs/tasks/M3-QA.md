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

## Result
- Summary: Added the M3 cost, money, FX, pricing, budget, P&L, append-only ledger, and pagination cases; corrected the duplicate FX case ID. New tests exposed two defects: fractional token cost used ceiling instead of half-up rounding, and pricing refresh swallowed a Hard Stop error. Both were fixed minimally.
- Files changed: 19 scoped source, test, and fixture files plus this task file's result section.
- Dependencies added (with reason): None. Installed the existing lockfile dependencies with `npm --cache .npm-cache install` because `node_modules` was absent; no package files changed.
- Decisions taken within scope: Used malformed regex match stubs to exercise defensive money parsing branches that cannot occur with valid regular expressions. Tested repository pagination at both the SQLite and sidecar RPC levels.
- Open issues / follow-ups: `npm run test:integration` was attempted, but all sidecar process tests fail at startup in this sandbox because `tsx` calls `os.userInfo()` and Node reports `uv_os_get_passwd returned ENOMEM`. QA should rerun integration outside the sandbox. TC-M3-023's all-sources-unreachable path has unit coverage; the fixed-fixture sidecar harness has no offline way to force that L3 fetch failure. E2E was not run, as requested.

Verification:

- `npm --cache .npm-cache run typecheck` — passed.
- `npm --cache .npm-cache run lint` — passed.
- `npm --cache .npm-cache test` — passed: 692 passed, 1 skipped.
- Targeted sidecar coverage: `cost.ts` 100% branches; `money.ts` 100%; `budget-guard.ts` 100%. Service statement coverage: ledger 96.83%, P&L 83.72%, revenue 82.35%, FX 88.14%, pricing service 93.83%, pricing updater 91.73%.
- Integration — attempted; blocked by the sandbox startup failure above. No E2E run.

| Case ID | Test file | Status |
|---|---|---|
| TC-M3-001 | `apps/sidecar/test/integration/ledger.test.ts` | Existing L3 case; integration execution blocked by sandbox |
| TC-M3-002 | `apps/sidecar/src/domain/cost.test.ts` | Implemented; passed |
| TC-M3-003 | `apps/sidecar/src/domain/cost.test.ts` | Implemented; passed |
| TC-M3-004 | `apps/sidecar/src/domain/cost.test.ts`, `apps/sidecar/test/integration/ledger.test.ts` | Implemented; passed unit; L3 execution blocked |
| TC-M3-005 | `apps/sidecar/src/services/ledger-service.test.ts` | Implemented; passed |
| TC-M3-006 | `apps/sidecar/src/domain/money.test.ts` | Implemented; passed |
| TC-M3-007 | `apps/sidecar/src/domain/cost.test.ts`, `apps/sidecar/src/domain/money.test.ts` | Implemented; passed |
| TC-M3-010 | `apps/sidecar/test/integration/ledger.test.ts` | Existing L3 case; integration execution blocked |
| TC-M3-011 | `apps/sidecar/src/services/pricing-service.test.ts`, `apps/sidecar/test/integration/pricing.test.ts` | Implemented; passed unit; L3 execution blocked |
| TC-M3-012 | `apps/sidecar/src/services/pricing-service.test.ts` | Implemented; passed |
| TC-M3-015 | `apps/sidecar/test/integration/chat.test.ts` | Renamed and extended; integration execution blocked |
| TC-M3-016 | `apps/sidecar/src/services/fx-service.test.ts` | Implemented; passed |
| TC-M3-017 | `apps/sidecar/src/services/fx-service.test.ts`, `apps/sidecar/test/integration/chat.test.ts` | Implemented; passed unit; L3 execution blocked |
| TC-M3-020 | `apps/sidecar/test/integration/pricing.test.ts` | Existing L3 case; integration execution blocked |
| TC-M3-021 | `apps/sidecar/test/integration/pricing.test.ts` | Existing L3 case; integration execution blocked |
| TC-M3-022 | `apps/sidecar/src/services/pricing-updater.test.ts`, `apps/sidecar/test/integration/pricing.test.ts` | Implemented; passed unit; L3 execution blocked |
| TC-M3-023 | `apps/sidecar/src/services/pricing-updater.test.ts` | Unit failure path implemented; L3 fetch failure unavailable in fixed offline harness |
| TC-M3-024 | `apps/sidecar/src/services/pricing-updater.test.ts`, `apps/sidecar/test/integration/pricing.test.ts` | Implemented with injected page fixture; integration execution blocked |
| TC-M3-025 | `apps/sidecar/src/services/pricing-updater.test.ts` | Implemented; passed |
| TC-M3-030 | `apps/sidecar/test/integration/budget.test.ts` | Existing L3 case; integration execution blocked |
| TC-M3-031 | `apps/sidecar/src/services/budget-guard.test.ts` | Verified; passed |
| TC-M3-032 | `apps/sidecar/src/services/budget-guard.test.ts` | Verified; passed |
| TC-M3-033 | `apps/sidecar/src/services/budget-guard.test.ts` | Verified; passed |
| TC-M3-034 | `apps/sidecar/src/services/budget-guard.test.ts` | Verified UTC midnight, month start, and leap-day reset; passed |
| TC-M3-035 | `apps/sidecar/src/services/budget-guard.test.ts` | Implemented; passed |
| TC-M3-036 | `apps/sidecar/src/services/budget-guard.test.ts`, `apps/sidecar/test/integration/budget.test.ts` | Implemented; passed unit; L3 execution blocked |
| TC-M3-037 | `apps/sidecar/test/integration/budget.test.ts` | Implemented; integration execution blocked |
| TC-M3-038 | `apps/sidecar/src/services/budget-guard.test.ts` | Verified; passed |
| TC-M3-040 | `apps/sidecar/test/integration/pnl.test.ts` | Existing L3 case; extended; integration execution blocked |
| TC-M3-041 | `apps/sidecar/src/domain/pnl.test.ts` | Verified range boundaries; passed |
| TC-M3-042 | `apps/sidecar/src/domain/pnl.test.ts`, `apps/sidecar/test/integration/pnl.test.ts` | Implemented; passed unit; L3 execution blocked |
| TC-M3-043 | `apps/sidecar/test/integration/pnl.test.ts` | Existing L3 case; extended; integration execution blocked |
| TC-M3-044 | `apps/sidecar/src/services/revenue-service.test.ts`, `apps/sidecar/test/integration/pnl.test.ts` | Implemented; passed unit; L3 execution blocked |
| TC-M3-045 | `apps/sidecar/test/integration/pipeline.test.ts` | Implemented; integration execution blocked |
| TC-M3-050 | `apps/sidecar/src/services/ledger-service.test.ts` | Implemented append-only API assertion; passed |
| TC-M3-051 | `apps/sidecar/src/infra/sqlite/ledger-repository.test.ts`, `apps/sidecar/test/integration/ledger.test.ts` | Implemented 250-row pagination; unit passed; L3 execution blocked |

## QA (Claude)
- Verdict: **PASS**. Real defect fixed: `pricing.refresh` swallowed `BUDGET_HARD_STOP` (1-line fix). QA reverted Codex's change from ceil to half-up token rounding — ARCH §6.1 specifies ceil; the error was in QA's own TC-M3-002 draft (corrected). QA test-design fix: TC-M3-015 sent `NaN` over JSON-RPC (serialises to `null` = clear override); NaN stays covered by the unit test. Gates: `cost.ts`, `money.ts`, `budget-guard.ts` 100 % branches; typecheck ✔, lint ✔, 693 unit ✔, integration 66/66 ×2.
