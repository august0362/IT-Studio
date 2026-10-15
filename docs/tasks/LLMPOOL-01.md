# LLMPOOL-01 — LLM key pool: sidecar module, router integration, RPC

Milestone: LLMPOOL add-on (CONTEXT D36) · **Do not start before the v1 sign-off and MOD-01/02** (paths below are pre-MOD; use the equivalent `kernel/…` / `modules/router/…` paths after MOD) · Role: Implementer (ROLES §1.3) · Size L · **Deps pre-installed** (better-sqlite3, drizzle, existing keychain library — no new packages)

## Goal

A self-contained module `apps/sidecar/src/modules/llm-pool/` that manages several API keys per provider, tracks token/USD/request usage per key, moves keys between ACTIVE / COOLDOWN / EXHAUSTED / INVALID / DISABLED, and lets the existing `LlmRouter` rotate to another key of the **same provider** before falling back to the next model. Removable: delete the folder, its contract section and the wiring lines listed below; the router then behaves exactly as today.

## Read first

**Test cases:** implement every **auto** case TC-LP-001…067 (layers U/R/I) from `docs/qa/LLMPOOL-test-cases.md`, case ID first in the test name.

`AGENTS.md`, `CONVENTIONS.md`, `CONTEXT.md` D4, D7, D15, D36, `ARCHITECTURE.md` §5 (router, fallback, circuit breaker), `apps/sidecar/src/services/llm-router.ts` (key lookup at `this.deps.secrets.get(model.provider)`), `apps/sidecar/src/ports/secret-store.ts`, `apps/sidecar/src/infra/keychain-secret-store.ts`, `apps/sidecar/src/infra/sqlite/**` (Drizzle setup to mirror), `apps/sidecar/src/container.ts`.

## Scope — files you may create/modify

- `apps/sidecar/src/modules/llm-pool/**` (new: everything incl. Drizzle schema, migrations folder, tests, `README.md`)
- `apps/sidecar/src/ports/key-pool.ts` (new; the only port core code depends on)
- `apps/sidecar/src/services/llm-router.ts` (+ test) — only the optional `keyPool` dependency and in-model key rotation
- `apps/sidecar/src/container.ts` — only: construct the module, pass `keyPool` to the router, register `llmPool.*` RPC, close the DB on shutdown
- `apps/sidecar/src/validation/ipc.ts` (+ test) — `llmPool.*` params/results
- `src/types/schemas.ts` — **additive only**: one delimited section `/* §LLM-POOL (add-on, D36) */` with exactly the contracts below + the RPC/notification map entries
- `apps/sidecar/test/integration/llm-pool.test.ts` (new) — `TC-LP-*` cases
- This task file (`## Result`)

## Contracts (`src/types/schemas.ts`, §LLM-POOL)

```ts
export type PoolKeyId = Brand<string, 'PoolKeyId'>;
export const PoolKeyState = { ACTIVE: 'active', COOLDOWN: 'cooldown', EXHAUSTED: 'exhausted', INVALID: 'invalid', DISABLED: 'disabled' } as const;
export type PoolKeyState = (typeof PoolKeyState)[keyof typeof PoolKeyState];
export const PoolStrategy = { PRIORITY: 'priority', ROUND_ROBIN: 'round_robin', LEAST_USED: 'least_used' } as const;
export type PoolStrategy = (typeof PoolStrategy)[keyof typeof PoolStrategy];

export interface PoolKeyLimits {
  readonly maxRequestsPerMinute?: number;
  readonly maxTokensPerDay?: number;
  readonly maxMicroUsdPerMonth?: MicroUsd;
  readonly maxConcurrent?: number;
}
export interface PoolUsageWindow {
  readonly requests: number; readonly inputTokens: number; readonly outputTokens: number; readonly costMicroUsd: MicroUsd;
}
export interface PoolKey {
  readonly id: PoolKeyId;
  readonly provider: ProviderId;
  readonly label: string;                 // 1–60 chars
  readonly maskedKey: string;             // e.g. "sk-…a1b2" — never the secret
  readonly priority: number;              // lower first
  readonly state: PoolKeyState;
  readonly stateReason?: string;          // safe text, e.g. "429 from provider"
  readonly cooldownUntil?: IsoDateTime;
  readonly exhaustedUntil?: IsoDateTime;  // next window boundary
  readonly limits: PoolKeyLimits;
  readonly today: PoolUsageWindow;
  readonly month: PoolUsageWindow;
  readonly inFlight: number;
  readonly lastUsedAt?: IsoDateTime;
  readonly createdAt: IsoDateTime;
}
export interface PoolConfig {
  readonly enabled: boolean;              // default false
  readonly strategy: PoolStrategy;        // default 'priority'
  readonly maxKeysPerRequest: number;     // 1–5, default 3
  readonly useSettingsKeyAsFallback: boolean; // default true: provider with no pool key uses Settings → API Keys
}
export type PoolEvent =
  | { readonly type: 'state'; readonly keyId: PoolKeyId; readonly state: PoolKeyState; readonly reason?: string }
  | { readonly type: 'usage'; readonly keyId: PoolKeyId }
  | { readonly type: 'rotated'; readonly provider: ProviderId; readonly from: PoolKeyId; readonly to: PoolKeyId; readonly reason: FailureKind };

// RPC map
'llmPool.list': { params: { readonly provider?: ProviderId }; result: readonly PoolKey[] };
'llmPool.add': { params: { readonly provider: ProviderId; readonly label: string; readonly apiKey: string; readonly priority?: number; readonly limits?: PoolKeyLimits; readonly verify: boolean }; result: PoolKey };
'llmPool.update': { params: { readonly id: PoolKeyId; readonly label?: string; readonly priority?: number; readonly limits?: PoolKeyLimits; readonly enabled?: boolean }; result: PoolKey };
'llmPool.remove': { params: { readonly id: PoolKeyId }; result: { readonly removed: boolean } };
'llmPool.reset': { params: { readonly id: PoolKeyId }; result: PoolKey };   // clears COOLDOWN / EXHAUSTED / INVALID → ACTIVE
'llmPool.importSettingsKey': { params: { readonly provider: ProviderId }; result: PoolKey };
'llmPool.getConfig': { params: Empty; result: PoolConfig };
'llmPool.updateConfig': { params: { readonly config: PoolConfig }; result: PoolConfig };
// notification map
'llmPool.event': PoolEvent;
```

## Module layout (create exactly these; names are binding)

```text
apps/sidecar/src/modules/llm-pool/
├── index.ts                 # facade: createLlmPoolModule(deps) → { keyPool: IKeyPool, rpc: register(server), start(), stop() }
├── types.ts                 # module-internal types (KeyRecord, UsageCounters, Clock-dependent helpers); public types come from @itstudio/schemas
├── pool-machine.ts          # PURE state machine: (record, event, now) → record; no I/O
├── pool-windows.ts          # PURE window math: dayKey(now, tz), monthKey, nextDayBoundary, nextMonthBoundary, rpm sliding window
├── pool-selector.ts         # PURE selection: (records, strategy, now, exclude) → keyId | null
├── account-pool-manager.ts  # in-memory state + reserve/release, limits, inFlight, event publishing, batched persistence
├── pool-secrets.ts          # keychain adapter (service 'itstudio-llm-pool'), in-memory secret cache, masking
├── storage/schema.ts        # Drizzle tables
├── storage/migrations/      # drizzle-kit output for this module only
├── storage/pool-repository.ts
├── pool-rpc.ts              # registers llmPool.* handlers on the RPC server
├── README.md
└── *.test.ts                # unit tests next to each file
```

## Data model (`storage/schema.ts`)

| Table | Columns |
|---|---|
| `llm_pool_keys` | `id` text PK, `provider` text, `label` text, `masked_key` text, `priority` int, `enabled` int (0/1), `state` text, `state_reason` text null, `cooldown_until` text null, `exhausted_until` text null, `consecutive_rate_limits` int default 0, `limits_json` text, `last_used_at` text null, `created_at` text |
| `llm_pool_usage_daily` | PK (`key_id`, `day` `YYYY-MM-DD` local), `requests` int, `input_tokens` int, `output_tokens` int, `cost_micro_usd` int; FK → keys ON DELETE CASCADE |
| `llm_pool_config` | single row `id = 1`, `config_json` text |

Month totals = SUM over `day` in the current local month (computed on load, then maintained in memory).

## Algorithms (binding)

- **acquire(provider, exclude)** — synchronous: (1) lazily expire COOLDOWN/EXHAUSTED whose time has passed (→ ACTIVE, emit `state`); (2) candidates = enabled keys of `provider`, state ACTIVE, not in `exclude`, `inFlight < maxConcurrent` (if set), RPM window count `< maxRequestsPerMinute` (if set), today tokens `< maxTokensPerDay`, month cost `< maxMicroUsdPerMonth`; a key failing a token/USD limit is moved to EXHAUSTED with `exhaustedUntil` = matching window boundary; (3) pick with `pool-selector`; (4) `inFlight++`, push `now` into its RPM window, set `lastUsedAt`; (5) return `{ keyId, apiKey }` from the secret cache. Cache miss → return `null` for that key and trigger an async keychain load (the request uses the next candidate or the Settings key); load the whole cache at `start()` so this is rare.
- **release(keyId, outcome)** — `inFlight--`; success: add usage/cost to today/month, reset `consecutive_rate_limits`, emit `usage` (throttled to ≤ 1 per key per second); failure → `pool-machine` event: `RATE_LIMITED` → COOLDOWN `until = now + (retryAfterMs ?? min(30 s × 2^(n-1), 15 min))`; `QUOTA_EXHAUSTED` → EXHAUSTED until next local midnight; `AUTH` → INVALID; `SERVER_ERROR`/`TIMEOUT` → no state change (model-level circuit handles it). Mark dirty for the batched writer.
- **Router loop change** (inside the existing per-model attempt): `tried: PoolKeyId[] = []`; loop up to `maxKeysPerRequest`: `acquire(provider, tried)` → null ⇒ break to existing behaviour (Settings key if `useSettingsKeyAsFallback` and no pool key was usable, else current failure path); call provider; if failure ∈ {RATE_LIMITED, QUOTA_EXHAUSTED, AUTH} and no delta was streamed ⇒ `release(fail)`, push attempt, emit `rotated`, continue; else release and exit the loop with the result. `AUTH` from a pool key does **not** stop the ladder (it is key-specific); `AUTH` from the Settings key keeps today's behaviour.
- **Windows** use the app's local timezone from the OS (`Intl.DateTimeFormat().resolvedOptions().timeZone`), computed with the injected clock; tests pin the clock and the timezone.

## RPC errors

`VALIDATION` for bad params / verify failure / duplicate label per provider; `NOT_FOUND` for unknown `id`; `CONFLICT` when removing a key with `inFlight > 0` (UI retries after in-flight completes); keychain failure → `INTERNAL` with safe message. Never echo the key.

## Requirements

1. **Port.** `ports/key-pool.ts`: `IKeyPool { acquire(provider, exclude: readonly PoolKeyId[]): Result<{ keyId: PoolKeyId; apiKey: string } | null>; release(keyId, outcome: { ok: true; usage; costMicroUsd } | { ok: false; failure: FailureKind; retryAfterMs?: number }): void }`. `acquire` is synchronous over in-memory state (check-and-reserve with no `await` in between; the secret is cached in memory after first keychain read) so concurrent requests never over-subscribe `maxConcurrent`.
2. **Router.** When `keyPool` is present and `config.enabled` and the provider has ≥ 1 usable pool key: acquire a key instead of `secrets.get`; on `RATE_LIMITED`, `QUOTA_EXHAUSTED` or `AUTH` **before the first streamed token**, release with the failure and retry the **same model** with the next key (exclude tried keys) up to `maxKeysPerRequest`; record each try as a `RouterAttempt` and emit `llmPool.event` `rotated`. Only when no key is left does the existing fallback/circuit logic run. Success releases with usage + the cost the router already computes. No pool key for the provider → existing `secrets.get` path when `useSettingsKeyAsFallback`, else skip with `CAPABILITY_MISMATCH`. Circuit breaker stays per model. Without `keyPool` the router is byte-for-byte today's behaviour (existing tests unchanged).
3. **State machine (pure, `pool-machine.ts`).** ACTIVE →(429 / `RATE_LIMITED`) COOLDOWN until `retryAfterMs` or backoff 30 s ×2 per consecutive hit, max 15 min; COOLDOWN → ACTIVE when time passes (lazy check on `acquire`/`list`). →(`QUOTA_EXHAUSTED` or a configured limit reached) EXHAUSTED until the next window boundary (local midnight for day limits, 1st of month 00:00 local for month limits; provider quota errors: next local midnight). →(`AUTH`) INVALID until the user resets or replaces the key. DISABLED only by the user. Successful call resets the consecutive-429 counter.
4. **Selection.** Among ACTIVE keys under their limits and `maxConcurrent`: `priority` = lowest priority, tie → least recently used; `round_robin` = rotate within the lowest priority group; `least_used` = fewest tokens today. `maxRequestsPerMinute` uses a sliding 60 s window.
5. **Storage.** Own SQLite file `<dataDir>/llm-pool.db`, Drizzle schema + migrations inside the module (applied on module start; tables `llm_pool_keys`, `llm_pool_usage_daily` (keyId, date, counters), `llm_pool_config`). Usage writes are batched (flush ≤ 1 s and on shutdown) so a request never waits on disk. State (cooldown/exhausted/invalid, consecutive hits) persists across restart. Removing a key deletes its keychain entry and its rows.
6. **Secrets.** Keys stored in the OS keychain via the existing keychain library under service `itstudio-llm-pool`, account = `PoolKeyId`; never in SQLite, logs, events, errors or RPC results (`maskedKey` only). `verify: true` uses the same verification request as `secrets.verifyAndSave` for that provider; failure → `VALIDATION` error, nothing stored.
7. **RPC.** All `llmPool.*` methods validated with strict Zod schemas; label 1–60, priority 0–100, limits positive safe integers. `llm-pool` module is constructed in `container.ts` only; the module never imports other services except through constructor-injected ports (keychain store, clock, logger, verifier, event publisher).
8. **README.md** in the module: what it does, how to disable (config `enabled: false`), how to remove (delete folder, the §LLM-POOL contract section, the `ipc.ts` entries, the container lines, the router `keyPool` branch is inert without the port).

## Tests

- Unit (module): state transitions incl. backoff sequence and cap, window boundaries (day/month, DST-safe with a fixed clock), each strategy, limits (RPM sliding window, tokens/day, USD/month, maxConcurrent), batching flush, persistence round-trip, secret never in returned objects.
- Router unit: rotation on 429/quota/auth before first token; no rotation after first token; exhausted pool → model fallback; no pool → unchanged; `useSettingsKeyAsFallback` both ways; attempts recorded.
- Integration `apps/sidecar/test/integration/llm-pool.test.ts` (scripted provider): `TC-LP-001` key A 429 → same model answered by key B, A in COOLDOWN; `TC-LP-002` all keys exhausted → next model; `TC-LP-003` state survives a sidecar restart; `TC-LP-004` key never appears in stdout/stderr/log file/`llmPool.list`.

## Acceptance criteria

- [ ] Requirements 1–8 met and tested; all existing router/integration tests unchanged and green.
- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass; QA runs the full integration suite.

## Hand-back

Append `## Result` per AGENTS.md §3.
