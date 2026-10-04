# M14-QA — Milestone QA gate: Facebook Page

Milestone: M14 · Depends on: M14-01…M14-04 · Size M · Process TESTING §7.
Test doubles: msw (L2), fake Graph HTTP server in the integration harness (`ITSTUDIO_E2E_GRAPH_BASE_URL`), optional live run with the owner's Page (Q-07, `ITSTUDIO_LIVE=1`).

## Planned cases (`docs/qa/M14-test-cases.md`)
| ID | Case | Technique | Level | Pri |
|---|---|---|---|---|
| TC-M14-001 | connect valid token; invalid / expired / missing permission | EP | L3 | P1 |
| TC-M14-002 | token never in logs (URLs stripped), RPC, DB | security | L3 + scan | P1 |
| TC-M14-010 | sync first / incremental / pagination; Page messages skipped | scenario | L3 | P1 |
| TC-M14-020 | draft gets `sendBefore`; approve within window → sent | scenario | L3 | P1 |
| TC-M14-021 | window BVA −1 s / 0 / +1 s; expired item blocked with remediation | BVA | L2+L3 | P1 |
| TC-M14-022 | rate-limit headers 89/90 %, codes 4/17/32/613/80006 → backoff, no calls until retryAt | decision table | L2 | P1 |
| TC-M14-023 | outside-window API error 10/2018278 → `MESSAGING_WINDOW_EXPIRED` | error guessing | L2 | P2 |
| TC-M14-030 | Inbox E2E with fake Graph: connect → sync → process → approve | scenario | L4 | P1 |
| TC-M14-031 | prompt-injection corpus via Messenger (reuse M12 corpus) | security negative | L3 | P1 |
| TC-M14-040 | (optional live) real Page sync + reply to a test user | acceptance | L5 | P2 |

Regression at this gate: full v2 L3 suite + E2E specs m10–m14 (v2 release candidate).
