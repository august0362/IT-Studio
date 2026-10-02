# M2 — QA Report — SIGNED OFF

> Gate `M2-QA` · QA: Claude · 2026-10-02 · Test cases: `docs/qa/M2-test-cases.md`

## Results

| Level | Result |
|---|---|
| L1/L2 unit + component | all pass on `main` after merge (see execution log) |
| L3 integration (real sidecar, scripted providers) | **47/47**, stable over 3 consecutive runs |
| L4 E2E | Not applicable for M2: chat/fallback UI lands in M4 — UI cases move to M4-QA (documented in test-case spec header) |
| White-box | llm-router 90.4 % branches (gate ≥ 90 ✔), circuit-breaker 100 %, router-machine 100 %, failure 100 % |

## Defects

| ID | Severity | Summary | Status |
|---|---|---|---|
| — | — | **No product defects found in M2.** Three integration failures were test defects: TC-M2-003 (exact-equality on partial object), TC-M2-004 (substring search instead of structured `circuit` event check), TC-M2-011 (scenario ignored ARCH §5.2 retry-before-fallback for 503 and reused the same reply text for both models). | Fixed in M2-QA (Codex round 1 + QA) |

## Exit criteria (TESTING.md §7)

- [x] 100 % P1 pass · [x] ≥ 95 % P2 pass · [x] no open S1/S2 · [x] coverage gates · [x] traceability (test-case spec §3) · [x] report committed

**Sign-off:** M2 — LLM router & providers is **DONE**. — QA (Claude), 2026-10-02
