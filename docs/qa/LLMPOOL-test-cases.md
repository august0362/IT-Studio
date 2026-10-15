# LLMPOOL — Test cases (CONTEXT D36)

Implementer: every case marked **auto** gets a test whose name starts with the case ID (e.g. `it('TC-LP-012 …')`). Cases marked **manual** are run by QA / the owner in the built app.

Layers: **U** unit (pure module / RTL), **R** router unit with fake providers, **I** integration (real sidecar, scripted provider), **M** manual.

## Pool state machine & windows (LLMPOOL-01)

| ID | Layer | Case | Expected |
|---|---|---|---|
| TC-LP-010 | U auto | 429 without Retry-After, 1st/2nd/3rd/6th consecutive | COOLDOWN 30 s / 60 s / 120 s / 15 min (cap) |
| TC-LP-011 | U auto | 429 with `retryAfterMs = 7000` | COOLDOWN until now + 7 s |
| TC-LP-012 | U auto | Success after two 429s | consecutive counter reset; next 429 → 30 s |
| TC-LP-013 | U auto | `QUOTA_EXHAUSTED` at 23:59 local | EXHAUSTED until 00:00 next day; ACTIVE after the boundary on next `acquire` |
| TC-LP-014 | U auto | `AUTH` | INVALID; never selected until `llmPool.reset` |
| TC-LP-015 | U auto | `SERVER_ERROR`, `TIMEOUT` | no state change |
| TC-LP-016 | U auto | `maxTokensPerDay` reached | EXHAUSTED until next midnight; resets next day |
| TC-LP-017 | U auto | `maxMicroUsdPerMonth` reached on the 31st | EXHAUSTED until 1st 00:00 local |
| TC-LP-018 | U auto | DST change day (fixed TZ with DST, e.g. Europe/Berlin) | boundaries correct, no double/missed reset |
| TC-LP-019 | U auto | `maxRequestsPerMinute = 2`, 3 acquires in 10 s, then at +61 s | 3rd skips the key; available again after 60 s |
| TC-LP-020 | U auto | `maxConcurrent = 1`, two synchronous acquires | second gets another key or null; never two in flight |
| TC-LP-021 | U auto | Disabled key | never selected; state DISABLED shown |

## Selection

| ID | Layer | Case | Expected |
|---|---|---|---|
| TC-LP-030 | U auto | `priority`: keys p0, p0, p5 | p0 keys only; tie → least recently used |
| TC-LP-031 | U auto | `round_robin` in p0 group of 3 | A, B, C, A … |
| TC-LP-032 | U auto | `least_used` | fewest tokens today first |
| TC-LP-033 | U auto | `exclude` list | excluded keys never returned |
| TC-LP-034 | U auto | all keys COOLDOWN | null |

## Router integration

| ID | Layer | Case | Expected |
|---|---|---|---|
| TC-LP-040 | R auto | Key A → 429, key B → OK (same model) | result from B; attempts: A rate_limited, B success; `rotated` event; no model fallback |
| TC-LP-041 | R auto | A quota, B auth, C OK | C answers; A EXHAUSTED, B INVALID |
| TC-LP-042 | R auto | All keys fail with 429 (`maxKeysPerRequest = 3`, 4 keys) | only 3 tried; then existing fallback to next model |
| TC-LP-043 | R auto | Stream: A fails **after** first delta | no rotation; existing error path |
| TC-LP-044 | R auto | No pool keys for provider, `useSettingsKeyAsFallback = true` | Settings key used (today's path) |
| TC-LP-045 | R auto | Same, `useSettingsKeyAsFallback = false` | model skipped `capability_mismatch` |
| TC-LP-046 | R auto | `keyPool` absent / `enabled = false` | identical attempts and result to the pre-pool router (existing tests untouched) |
| TC-LP-047 | R auto | Success | usage + cost released to the key; ledger unchanged vs today |
| TC-LP-048 | R auto | Cancel during a pool-key call | `inFlight` returns to 0; no state change |

## Storage, secrets, RPC

| ID | Layer | Case | Expected |
|---|---|---|---|
| TC-LP-060 | U auto | 100 releases in 200 ms | ≤ 1 DB flush per second; totals exact after `stop()` |
| TC-LP-061 | U auto | Reload from DB | states, cooldowns, today/month totals restored |
| TC-LP-062 | U auto | `llmPool.list` / events / errors | contain `maskedKey`, never the secret (scan JSON for the raw key) |
| TC-LP-063 | U auto | `llmPool.add` verify=true, provider rejects | `VALIDATION`; nothing in keychain or DB |
| TC-LP-064 | U auto | duplicate label for provider; label 0/61 chars; priority 101; negative limit; extra keys | `VALIDATION` |
| TC-LP-065 | U auto | `llmPool.remove` with in-flight | `CONFLICT`; after release → removed + keychain entry deleted |
| TC-LP-066 | U auto | `llmPool.importSettingsKey` | key copied to pool keychain entry; Settings key untouched |
| TC-LP-067 | U auto | `llmPool.reset` on INVALID / EXHAUSTED / COOLDOWN | ACTIVE, counters intact |
| TC-LP-001 | I auto | Scripted provider: key A 429, key B OK | answer from B; `llmPool.list` shows A COOLDOWN |
| TC-LP-002 | I auto | All pool keys exhausted | next ladder model answers |
| TC-LP-003 | I auto | Restart sidecar while A in COOLDOWN | still COOLDOWN after restart with same `cooldownUntil` |
| TC-LP-004 | I auto | Raw key never in stdout/stderr/log file/`llmPool.list` | absent |
| TC-LP-005 | I auto | Delete `llm-pool.db` while stopped | module recreates it; core app unaffected |

## Desktop page (LLMPOOL-02)

| ID | Layer | Case | Expected |
|---|---|---|---|
| TC-LP-100 | U auto | Config save | `llmPool.updateConfig` with edited values |
| TC-LP-101 | U auto | Add with verify OK / `VALIDATION` | row added / dialog stays with error |
| TC-LP-102 | U auto | Import from API Keys button shown only when a Settings key exists | — |
| TC-LP-103 | U auto | Edit limits validation | inline errors; no RPC on invalid |
| TC-LP-104 | U auto | Remove → confirm → `CONFLICT` | message "in use, try again" |
| TC-LP-105 | U auto | COOLDOWN countdown | ticks every second; refetch at 0 shows ACTIVE |
| TC-LP-106 | U auto | 10 `rotated` events in 1 s | 1 toast group, 1 refetch |
| TC-LP-107 | U auto | After save, DOM contains no full key | — |
| TC-LP-108 | M manual | Built app, 2 real OpenAI keys, one revoked | revoked key → INVALID, chat still answers with the other key |
| TC-LP-109 | M manual | Pool disabled | chat/pipeline behave exactly as before |

## Gateway (LLMPOOL-03, phase 2)

Defined when LLMPOOL-03 is scheduled.
