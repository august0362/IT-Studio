# M1 — QA Report (in progress)

> Gate `M1-QA` · QA: Claude · Started 2026-10-02 · Test cases: `docs/qa/M1-test-cases.md`

## Defects

| ID | Severity | Summary | Found by | Linked TC | Status |
|---|---|---|---|---|---|
| BUG-M1-001 | S3 (test defect) | `rpc-server.test.ts` "keeps concurrent request ids…" flaky (~1/8 full runs): completion order forced by real 5 ms/0 ms timers inverts under load. Product behaviour correct. | Regression loop on `main` after M7-01 merge | TC-M1-015 (related) | Open → fix task `M1-FIX1` |

| BUG-M1-002 | S4 (improvement) | Invalid-envelope responses (-32600) use `id: null` even when a numeric id is readable. Spec-compliant (JSON-RPC 2.0 §5) but the UI cannot correlate and waits for its 30 s timeout. UI never sends invalid envelopes → low risk. Proposal: echo the id when it is a valid integer. | Exploratory probe | TC-M1-011 | Open (deferred, low priority) |

## Execution log

- 2026-10-02: full suite on `main` ×12 → 11 pass, 1 fail (BUG-M1-001). Lint ✔, typecheck ✔.
- 2026-10-02: **exploratory L3 probe against the real sidecar process** (manual QA script, independent of Codex automation):

| TC | Result | Note |
|---|---|---|
| TC-M1-002 | PASS | first stdout line = system.ready |
| TC-M1-003 | PASS | 122 stdout lines, all JSON-RPC |
| TC-M1-010 | PASS | -32700, id null, process alive |
| TC-M1-011 | PASS | -32600 with id null → BUG-M1-002 (S4) |
| TC-M1-012 | PASS | -32601 |
| TC-M1-013 | PASS | -32602 VALIDATION, input value not echoed |
| TC-M1-015 | PASS | 100 shuffled concurrent ids matched |
| TC-M1-016 | PASS | 3-chunk split + CRLF |
| TC-M1-020 | PASS | defaults valid, ladder=5, theme arctic-focus |
| TC-M1-021 | PASS | autoFallback=false persisted across restart |
| TC-M1-022 | PASS | unknown themeId → VALIDATION |
| TC-M1-024 | PASS* | *oracle corrected: missing path → NOT_FOUND (more precise than spec'd VALIDATION) |
| TC-M1-031 | PASS | 5 invalid key partitions → VALIDATION |

- Pending: L3/L4 automation (`M1-QA` Codex task), exploratory session, coverage + mutation numbers, sign-off.
