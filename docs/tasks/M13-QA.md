# M13-QA — Milestone QA gate: Gmail

Milestone: M13 · Depends on: M13-01…M13-07 · Size M · Process TESTING §7.
Test doubles: msw at L2; at L3 a **fake Gmail HTTP server** in the integration harness (OAuth token + Gmail endpoints, scripted) selected with `ITSTUDIO_E2E=1` + `ITSTUDIO_E2E_GMAIL_BASE_URL`; optional live run with the owner's account (Q-06) using `ITSTUDIO_LIVE=1`.

## Planned cases (`docs/qa/M13-test-cases.md`)
| ID | Case | Technique | Level | Pri |
|---|---|---|---|---|
| TC-M13-001 | OAuth connect success (PKCE, state) → account + keychain entry | scenario | L3 | P1 |
| TC-M13-002 | wrong state / timeout / missing refresh token | EP + error guessing | L2/L3 | P1 |
| TC-M13-003 | tokens never in RPC, logs, DB | security | L3 + scan | P1 |
| TC-M13-010 | first sync window + incremental history sync | scenario | L3 | P1 |
| TC-M13-011 | history 404 fallback; 401 refresh; 429 backoff | error guessing | L2 | P1 |
| TC-M13-012 | MIME corpus → plain text (HTML-only, charset, attachments names) | EP | L2 | P2 |
| TC-M13-020 | approve reply → sent in-thread with correct headers | scenario | L3 | P1 |
| TC-M13-021 | header injection attempts rejected | security negative | L2 | P1 |
| TC-M13-030 | labels after confirmed triage only | scenario | L3 | P2 |
| TC-M13-040 | email command decision table R1–R5 | decision table | L2+L3 | P1 |
| TC-M13-041 | command runs only after in-app confirmation; pipeline only when allowed | state | L3 | P1 |
| TC-M13-042 | spoofed `Authentication-Results` from non-Google host ignored | security negative | L2 | P1 |
| TC-M13-050 | email P&L report → Outbox pending to self | scenario | L3 | P2 |
| TC-M13-060 | Inbox E2E with fake Gmail: connect (fake consent page) → sync → process → approve | scenario | L4 | P1 |
| TC-M13-070 | (optional live) real account connect + sync + send to self | acceptance | L5 | P2 |

Exploratory: Vietnamese mail, long threads, newsletters with heavy HTML, invalid client id.
