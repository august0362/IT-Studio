# M5 — QA Report — CONDITIONAL SIGN-OFF (E2E follow-up open)

> Gate `M5-QA` · QA: Claude · 2026-10-03 · Test cases: `docs/qa/M5-test-cases.md`

## Results
| Level | Result |
|---|---|
| L1/L2 unit | all pass; chunker 90.8 %, parse-document 93 %, rag-service 90.8 %, retriever 100 %, mmr 100 %, vector-store 80.5 % branches |
| L3 integration (real SQLite + LanceDB, fake embeddings) | all M5 cases pass (101/101 suite) incl. TC-M5-009 embedding fallback and TC-M5-036 code-only ingest |
| L4 E2E | **pass:** TC-M5-020 (add source → indexed → query hit), TC-M5-021 · **open (test-setup):** TC-M5-022 (delete confirm/cancel), TC-M5-023 (citation popover) — failed after an earlier failure in the same spec session |

## Defects
| ID | Sev | Summary | Status |
|---|---|---|---|
| BUG-M5-001 | S2 | Code-first ingest lost files: LanceDB inferred the table schema from the first row (empty `sectionPath`) | Fixed (explicit Arrow schema), TC-M5-036 |
| — | S2 (design) | Retrieval re-embedded every MMR candidate per query (cost/latency) | Fixed in M5-06 fix round (one embedding call per query, TC-M5-012) |

## Exit criteria
- [ ] 100 % P1 pass — **not met at L4**: TC-M5-023 open (follow-up **QA-E2E-FIX2**); covered at L3 by TC-M5-011 (citation part) and L2 (chip/popover component tests).
- [x] no open S1/S2 · [x] coverage gates · [x] traceability · [x] report committed

**Sign-off:** M5 — RAG is **accepted for the v1 hand-over** with QA-E2E-FIX2 open. — QA (Claude), 2026-10-03
