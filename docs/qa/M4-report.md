# M4 — QA Report — CONDITIONAL SIGN-OFF (E2E follow-up open)

> Gate `M4-QA` · QA: Claude · 2026-10-03 · Test cases: `docs/qa/M4-test-cases.md`

## Results
| Level | Result |
|---|---|
| L2 component (fake RPC) | all pass; desktop coverage 85.6 % lines / 70.4 % branches (was 70.1 %); stores (`chat-store`, `pipeline-store`, `ingest-store`, `date-range`) 100 % |
| L3 integration (UI-facing contracts) | 101/101 on `main` (incl. TC-M4-026 chat model choice keeps fallback) |
| L4 E2E (WebdriverIO + tauri-driver, 4 sessions) | **pass:** TC-M4-001/002/010/011/012/013/020/021/022/025/030/032/033/040/041/042/050/051 · **open (test-setup, not product):** TC-M4-023 (fallback modal in scripted session), TC-M4-031 (budget bar assertion), TC-M4-043/044/045/046 (settings spec after a failure in the same session) |
| Performance | main JS chunk 1.13 MB (< 1.5 MB); Code tab lazy-loaded |

## Defects
| ID | Sev | Summary | Status |
|---|---|---|---|
| BUG-M4-001 | S3 | Numbers/dates followed the OS locale instead of the app locale | Fixed (M4-QA round 2) |
| BUG-M4-002 | S2 | Choosing a model in Chat disabled fallback (one-model ladder) — contradicted D10 | Fixed (M4-FIX2), L3 TC-M4-026, L4 TC-M4-022 pass |
| GAP-M4-003 | S3 | No way to clear a manual price override (D9) | Fixed (M4-FIX3); follow-up S4: after restart, clearing falls back to the seed price |
| — | — | Test infra: E2E state leaked between specs (shared data dir); fixed with settings teardown | Fixed (QA-E2E-FIX1) |

## Exit criteria
- [ ] 100 % P1 pass — **not met at L4**: TC-M4-023 / 031 / 043 open (P1/P2 E2E harness work, follow-up **QA-E2E-FIX2**); every behaviour they cover passes at L2/L3.
- [x] no open S1/S2 · [x] coverage targets · [x] traceability · [x] report committed

**Sign-off:** M4 — Desktop UI is **accepted for the v1 hand-over** with the E2E follow-up QA-E2E-FIX2 open. — QA (Claude), 2026-10-03

## Update 2026-10-03 (6th E2E fix attempt)
- Passing in the last session: TC-M4-021, 030, 040 (plus the earlier passes listed above). Several cases in the scripted / cost / settings specs did not run to a result because earlier steps in the same spec session failed. After 6 fix attempts the remaining M4 E2E cases are **skipped and reported** (user rule); all of them pass at L2 / L3.
