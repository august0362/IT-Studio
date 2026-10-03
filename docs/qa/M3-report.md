# M3 — QA Report — SIGNED OFF

> Gate `M3-QA` · QA: Claude · 2026-10-03 · Test cases: `docs/qa/M3-test-cases.md` · Automation: `docs/tasks/M3-QA.md`

## Results

| Level | Result |
|---|---|
| L1/L2 unit | all pass on `main` (693 at gate time) |
| L3 integration (real sidecar, scripted providers, fake FX/pricing HTTP) | **66/66 ×2** consecutive runs on the M3-QA branch; whole suite later 98/98 ×2 on `main` |
| L4 E2E | not applicable for M3 — the Cost & P&L and Settings UI cases (TC-M4-030…045) are executed under M4-QA |
| White-box (TESTING.md §3) | `domain/cost.ts` **100 %**, `domain/money.ts` **100 %**, `services/budget-guard.ts` **100 %** branches (safety-critical gate ✔); `budget.ts`, `pnl.ts`, `price-validation.ts` 100 %; services ≥ 80 % statements (ledger 96.8, pricing 93.8, updater 91.7, FX 88.1, P&L 83.7, revenue 82.4) |

Case status: every case in the spec automated and passing, except **TC-M3-023** (all pricing sources unreachable) which is covered at L2 only — the offline sidecar harness cannot force an L3 fetch failure (P2, accepted).

## Defects

| ID | Severity | Summary | Status |
|---|---|---|---|
| BUG-M3-001 | S2 | `pricing.refresh` treated `BUDGET_HARD_STOP` from the extraction call like a provider failure and continued (Hard Stop not honoured for app-overhead calls). | Fixed in M3-QA (1-line), covered by TC-M3-037 |
| — | — | **QA test-design defects (not product):** TC-M3-002 first draft asked for half-up rounding while ARCH §6.1 specifies `ceil` (QA corrected the spec and reverted Codex's rounding change); TC-M3-015 sent `NaN` over JSON-RPC (serialises to `null` = clear override); duplicate test ID TC-M3-020 renamed to TC-M3-015. | Fixed in M3-QA |

## Exploratory session (20 min)
Malformed / negative seed prices, FX override toggled during a stream, tiny budget + Hard Stop + RAG ingest. No unmetered calls, no float artefacts, Hard Stop blocks embeddings and pricing extraction with remediation.

## Exit criteria (TESTING.md §7)

- [x] 100 % P1 pass · [x] ≥ 95 % P2 pass (1 P2 at L2 only) · [x] no open S1/S2 · [x] coverage gates · [x] traceability (spec §3) · [x] report committed

**Sign-off:** M3 — Cost, pricing, FX, budget, P&L is **DONE**. — QA (Claude), 2026-10-03
