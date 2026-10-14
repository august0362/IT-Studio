# M11-QA — Milestone QA gate: Agent Memory

Milestone: M11 · Depends on: M11-01…M11-07 · Roles: QA designs/executes, Codex automates · Size M · Process TESTING §7.

## Step 1 — `docs/qa/M11-test-cases.md` (planned cases)
| ID | Case | Technique | Level | Pri |
|---|---|---|---|---|
| TC-M11-001 | extraction after conversation switch stores durable facts | scenario | L3 | P1 |
| TC-M11-002 | external-trigger turns not extracted (default) / extracted when enabled | decision table | L3 | P1 |
| TC-M11-003 | app exit does not call the LLM; pending flag; extraction on reopen | state | L3 | P1 |
| TC-M11-004 | secret / PII corpus never stored (extracted, manual, tool) | security negative | L2+L3 | P1 |
| TC-M11-005 | dedupe at cosine 0.9199 / 0.92 | BVA | L2 | P1 |
| TC-M11-006 | recall ranking (importance, recency, pinned, floor 0.3) | BVA | L2 | P1 |
| TC-M11-007 | new conversation recalls a stated preference (exit criterion) | scenario | L3 | P1 |
| TC-M11-008 | remember phrase en/vi, message action, tool (not for external) | EP | L3 | P1 |
| TC-M11-010…012 | memory RPC CRUD / forgetAll / export / cleanup | scenario | L3 | P1/P2 |
| TC-M11-013 | no memory text in logs / activity events / RPC beyond memory.* | security | L3 + scan | P1 |
| TC-M11-014 | 10 000 memories: forgetAll + export < 5 s; recall p95 ≤ 300 ms | NFR-V2-06/07 | L3 | P2 |
| TC-M11-020 | Memory page: remember → view → pin → edit → delete | scenario | L4 | P1 |
| TC-M11-021 | Forget everything requires typed agent name | error guessing | L4 | P2 |

## Step 2 — Codex automates (case IDs in names; per-spec fresh data dir for E2E; do not run E2E).
## Step 3 — QA executes + exploratory (Vietnamese memories, long sessions, model switch → cleanup re-embed) → `docs/qa/M11-report.md`.

## Exit
TESTING §7 criteria; ROADMAP M11 ticked; HANDOFF updated.
