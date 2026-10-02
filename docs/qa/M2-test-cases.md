# M2 — Test Case Specification (LLM router, providers, chat)

> QA gate `M2-QA` · Author: QA (Claude) · 2026-10-02 · Strategy: `TESTING.md`
> Scope: M2-01…M2-10 — provider port + 3 adapters, model/provider registry, router machine + service, circuit breaker, Auto Fallback OFF decisions, router config RPC, ChatService.
> Levels: **L3** = real sidecar over stdio with `ITSTUDIO_E2E=1` scripted LLM fixtures (extend `apps/sidecar/test/fixtures/llm/*.json` to script per-model outcomes) · **L4** = real app (UI for chat/fallback arrives in M4 → M2 L4 cases are limited to RPC-visible behaviour through the existing UI shell; full UI cases move to M4-QA).

## 1. Black-box cases

### 1.1 Router decision table (failure kind × autoFallback × candidates left × retries left)

| ID | Rule | Level | Pri | Script (models A,B in ladder) | Expected |
|---|---|---|---|---|---|
| TC-M2-001 | R1 success | L3 | P1 | A → ok | answer from A; 1 ledger-ready completion; no fallback event |
| TC-M2-002 | R2 transient retry | L3 | P1 | A → 503, A → ok | `router.event{state: retry_wait}`; answer from A; attempts = 2 |
| TC-M2-003 | R3 429 → fallback (Auto ON) | L3 | P1 | A → 429 (retry-after 30 s), B → ok | no same-model retry (30 s > 10 s); `router.event{fallback A→B, rate_limited}`; answer from B |
| TC-M2-004 | R4 quota → fallback + circuit | L3 | P1 | A → quota, B → ok; then 2nd request | 2nd request skips A (`attempt skipped`, circuit open) |
| TC-M2-005 | R5 auth → fail fast | L3 | P1 | A → 401 | `chat.failed` `PROVIDER_AUTH` with remediation "re-enter key"; B never called |
| TC-M2-006 | R6 ladder exhausted | L3 | P1 | A → 503×3, B → 503×3 | `LADDER_EXHAUSTED`, remediation lists A and B with reasons |
| TC-M2-007 | R7 Auto OFF → ask user → use B | L3 | P1 | autoFallback=false; A → 429 | `router.fallbackRequired` with candidates [B] + cost estimate; `router.resolveFallback{use_model B}` → answer from B |
| TC-M2-008 | R8 Auto OFF → abort | L3 | P1 | as 007, decision abort | `chat.failed` `FALLBACK_DECLINED` |
| TC-M2-009 | R9 Auto OFF → timeout | L3 | P2 | userDecisionTimeoutMs = 10 000 (min), no decision | `FALLBACK_DECLINED` after expiry |
| TC-M2-010 | Chat streaming over stdio | L3 | P1 | A → stream 3 deltas | `chat.delta`×3 then `chat.completed` (exists, M2-10) |
| TC-M2-011 | Mid-stream failure | L3 | P1 | A → 2 deltas then 503; B → ok | `router.event{fallback}` before B's deltas; final message from B only; persisted assistant message = B text |
| TC-M2-012 | Cancel | L3 | P1 | A → slow stream | `chat.cancel` → `chat.failed CANCELLED`; no assistant message persisted |
| TC-M2-013 | Content filtered | L3 | P2 | A → content_filter | fail without fallback, user-facing message |

### 1.2 Boundary values

| ID | Item | Values | Expected |
|---|---|---|---|
| TC-M2-020 | retry-after threshold | 9 999 ms / 10 000 ms / 10 001 ms | retry same / retry same / fallback |
| TC-M2-021 | maxRetries | 0 / 2 / 5 (config) | attempts on A = 1 / 3 / 6 before fallback |
| TC-M2-022 | Router config validation | priorities duplicate; maxRetries 6; timeoutMs 4 999 / 300 001; userDecisionTimeoutMs 9 999 | VALIDATION each; stored config unchanged |
| TC-M2-023 | Circuit threshold | 2 vs 3 consecutive failures (threshold 3) | closed after 2, open after 3; half-open probe after cooldown (fake clock, L2) |

### 1.3 State-transition coverage (L2, already in M2-06 table tests) — QA verifies the table covers every (state, input) pair → **checklist item, no new test**.

### 1.4 Model ordering & eligibility (EP)

| ID | Partition | Expected |
|---|---|---|
| TC-M2-030 | lockedModelKey = B | B tried first, then ladder minus B |
| TC-M2-031 | model without API key | skipped (`capability_mismatch`), next model used |
| TC-M2-032 | model disabled in ladder | never tried |
| TC-M2-033 | Gemini models | eligible now that GoogleProvider is registered (`models.list` + eligibility) |

### 1.5 Chat persistence & concurrency

| ID | Case | Expected |
|---|---|---|
| TC-M2-040 | Conversation survives restart | create, send, restart sidecar, `chat.getMessages` returns both messages |
| TC-M2-041 | Busy conversation | 2nd `chat.send` while streaming → `CONFLICT` |
| TC-M2-042 | Two conversations in parallel | both complete, messages not interleaved |
| TC-M2-043 | Auto-title | first assistant reply → title = first 60 chars of first user message; no extra LLM call (fixture call count) |

### 1.6 Security negatives

| ID | Case | Expected |
|---|---|---|
| TC-M2-050 | API key never leaves sidecar | grep stdout/stderr/log/DB after TC-M2-001..012 for the fixture keys → absent |
| TC-M2-051 | Provider error body not leaked | provider returns error JSON containing a fake key → message shown to UI excludes it |

## 2. White-box targets

| Module | Target | Current | Action |
|---|---|---|---|
| `domain/router-machine.ts` | 100 % branch | 100 % | — |
| `domain/failure.ts` | 100 % | 100 % | — |
| `services/llm-router.ts` | ≥ 90 % branch (gate) | **76 %** | add unit cases for uncovered branches (ordering edge cases, abort before dispatch, completion on billed failure without usage) |
| `services/circuit-breaker.ts` | 100 % branch | 100 % lines | confirm branches |
| `services/chat-service.ts` | ≥ 85 % lines | ? | measure at gate |
| Provider adapters | contract suite + ≥ 85 % lines each | measure | — |
| Mutation (StrykerJS) | report only | — | run on `domain/router-machine.ts`, `domain/failure.ts` |

## 3. Traceability

| Requirement | Cases |
|---|---|
| D10 Auto Fallback ON/OFF, ladder, lock | TC-M2-003, 007–009, 030 |
| ARCH §5.2 failure classification | TC-M2-002–006, 013, 020 |
| ARCH §5.3 mid-stream & cancel | TC-M2-011, 012 |
| M2 exit criteria (ROADMAP) | TC-M2-003, 004, 007 |
| M2-10 chat backend | TC-M2-010, 040–043 |
| D2 key secrecy | TC-M2-050, 051 |

## 4. Automation hand-off (`M2-QA`)

Extend the `ITSTUDIO_E2E` scripted provider to accept per-model outcome sequences (`ok`, `stream:n`, `http:<status>[:retryAfterMs]`, `quota`, `auth`, `content_filter`, `delay:<ms>`), selectable per test via a fixture file path env var. Implement all L3 cases above in `apps/sidecar/test/integration/router.test.ts` and `chat.test.ts`; add the missing `llm-router.ts` branch tests. Test titles start with the TC id.
