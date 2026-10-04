# M12-QA — Milestone QA gate: Channels framework, Outbox, VS Code chat

Milestone: M12 · Depends on: M12-01…M12-08 · Size L · Process TESTING §7.

## Step 1 — `docs/qa/M12-test-cases.md` (planned cases)
| ID | Case | Technique | Level | Pri |
|---|---|---|---|---|
| TC-M12-001 | sync idempotent, cursor kept on failure | scenario | L3 | P1 |
| TC-M12-002 | no background traffic: idle 10 min → 0 syncs, 0 ledger rows | NFR-V2-01 | L3 | P1 |
| TC-M12-003 | concurrent sync single-flight | error guessing | L2 | P2 |
| TC-M12-010 | draft → approve → exactly one send | state | L3 | P1 |
| TC-M12-011 | every Outbox transition incl. illegal ones | state transition | L2 | P1 |
| TC-M12-012 | send cap 19/20/21 within 60 min; window ± 1 s | BVA | L2+L3 | P1 |
| TC-M12-013 | crash mid-send → `failed/unknown`, no resend | error guessing | L3 | P1 |
| TC-M12-014 | no bulk approve via RPC or UI | security | L3+L4 | P1 |
| TC-M12-020 | triage batching 0/1/20/21; command coercion | BVA | L2 | P2 |
| TC-M12-021 | process → draft pending, nothing sent | scenario | L3 | P1 |
| TC-M12-022 | prompt-injection corpus (≥ 15) → no send, no forbidden tool, no memory, no pipeline | security negative | L3 | P1 |
| TC-M12-023 | secret scan: tokens absent from logs / DB / RPC | security | L3 + scan | P1 |
| TC-M12-030 | Inbox E2E: sync → process → edit → approve → sent | scenario | L4 | P1 |
| TC-M12-031 | Inbox renders 1 000 messages smoothly | NFR-V2-06 | L4 | P3 |
| TC-M12-040 | VS Code v2 chat round trip (WS client) | scenario | L3 | P1 |
| TC-M12-041 | VS Code panel E2E (new window) | scenario | VS Code E2E | P1 |
| TC-M12-042 | v1 extension still connects (protocol 1) | compatibility | L3 | P1 |
| TC-M12-043 | webview renders model HTML/script payloads inert | security (XSS) | VS Code E2E/L2 | P1 |
| TC-M12-050 | Workflow map shows channel modules without message content | security | L3 | P2 |

## Step 2 — Codex automates; Step 3 — QA executes + exploratory (keyboard-only Inbox, Vietnamese messages, long threads) → `docs/qa/M12-report.md`.
