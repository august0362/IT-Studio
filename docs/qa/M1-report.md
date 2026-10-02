# M1 — QA Report (in progress)

> Gate `M1-QA` · QA: Claude · Started 2026-10-02 · Test cases: `docs/qa/M1-test-cases.md`

## Defects

| ID | Severity | Summary | Found by | Linked TC | Status |
|---|---|---|---|---|---|
| BUG-M1-001 | S3 (test defect) | `rpc-server.test.ts` "keeps concurrent request ids…" flaky (~1/8 full runs): completion order forced by real 5 ms/0 ms timers inverts under load. Product behaviour correct. | Regression loop on `main` after M7-01 merge | TC-M1-015 (related) | Open → fix task `M1-FIX1` |

## Execution log

- 2026-10-02: full suite on `main` ×12 → 11 pass, 1 fail (BUG-M1-001). Lint ✔, typecheck ✔.
- Pending: L3/L4 automation (`M1-QA` Codex task), exploratory session, coverage + mutation numbers, sign-off.
