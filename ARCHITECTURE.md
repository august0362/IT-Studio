# ARCHITECTURE.md — High-Level Architecture & Component Specifications

> Prerequisite: `CONTEXT.md`. Types referenced as `` `TypeName` `` live in `src/types/schemas.ts`.
> Section numbers are stable: task files and code comments cite them as `ARCH §x.y`.

---

## 1. Principles

1. **Thin edges, thick core.** React = presentation + local UI state. Rust = process shell. All business logic = Node sidecar.
2. **Contracts first.** Every cross-boundary payload is a type in `schemas.ts` and a zod validator in `apps/sidecar/src/validation/`. Validators are the runtime mirror of the types; a test asserts they stay in sync (`z.infer` ⇔ type equality).
3. **Services never throw across layers.** Public service methods return `Result<T>`; only the RPC layer converts `AppError` to `RpcError`.
4. **Dependency inversion.** Services depend on interfaces (`ILlmProvider`, `ISecretStore`, `ILedgerRepository`, `IVectorStore`, `IClock`, `IFileSystem`, `IProcessRunner`), wired in one composition root (`apps/sidecar/src/container.ts`). All I/O is injectable → every service is unit-testable without network or disk.
5. **Append-only money.** Ledger rows are immutable; corrections are new rows.
6. **Fail safe, report clearly.** Every failure that changes disk state is rolled back and produces a `FailureReport` with `nextSteps`.

## 2. Process model & lifecycle

### 2.1 Processes

| Process | Tech | Responsibility | Lifetime |
|---|---|---|---|
| Tauri main | Rust (Tauri v2) | Window, spawn/supervise sidecar, relay NDJSON, expose 1 command + 1 event to webview | App lifetime |
| Webview | React 19 + Vite + TS | UI | App lifetime |
| Sidecar | Node 24 (tsx in dev; bundled in M9) | All services | Supervised child of Tauri |
| VS Code | Electron (external) | Live viewer | Launched by sidecar; survives app exit |
| Extension host | VS Code ext (TS) | Bridge to sidecar | While VS Code open on the project |
| Commands | npm / tsc / eslint / vitest | Validation | Per `CommandRun` |

### 2.2 Startup sequence

1. Tauri starts → resolves app data dir (`%APPDATA%/com.itstudio.app/`) → spawns sidecar with env `ITSTUDIO_DATA_DIR`, `ITSTUDIO_LOG_LEVEL`.
2. Sidecar: load config → open SQLite + run migrations → open LanceDB → **recover journals** (§9.4) → start scheduler (FX daily fetch only — no LLM; pricing updates are manual, D9) → start VSCodeBridge WS server → emit notification `system.ready` (`RpcNotificationMap`).
3. Rust forwards `system.ready`; UI then calls `settings.get`, `project.list`, `secrets.status`.
4. If `settings.vscode.autoLaunch` and a project is active → `workspace.openInVSCode`.

### 2.3 Supervision

- Rust restarts the sidecar on unexpected exit with backoff 1 s, 2 s, 4 s, max 5 restarts per 5 min; then emits `sidecar://fatal` and the UI shows a blocking error with log path.
- In-flight RPC requests at crash time are failed by the UI `RpcClient` with `INTERNAL` ("sidecar restarted").
- Graceful shutdown: Rust sends `system.shutdown` request → sidecar cancels runs (pipeline in WRITING/VALIDATING is rolled back), flushes DB, exits within 5 s, else killed.

## 3. IPC protocol (React ⇄ Rust ⇄ Sidecar)

### 3.1 Transport

- **Framing:** NDJSON — one JSON object per line, UTF-8, `\n` terminated. Max line 8 MiB (larger payloads must be chunked or referenced by id).
- **Sidecar stdout = protocol only.** Logs go to stderr + file. Any non-JSON stdout line is a bug.
- **Rust is a dumb pipe:** Tauri command `sidecar_send(line: String)` writes to sidecar stdin; each stdout line is emitted to the webview as event `sidecar://message`. Rust does not parse payloads (except recognizing `system.ready`).
- Tauri capability file grants the webview **only** `sidecar_send`, the event listener, and window APIs. No shell, fs, or http plugins exposed to the webview.

### 3.2 Messages

- Requests/responses/notifications: `RpcRequest`, `RpcResponse`, `RpcNotification` (`schemas.ts` §10).
- Method catalog: `RpcMethodMap`. Push events: `RpcNotificationMap`.
- `id` is a monotonically increasing integer per UI session. Default UI timeout 30 s; long operations (`chat.send`, `pipeline.start`, `rag.ingest`) return immediately and stream progress via notifications.

### 3.3 Errors

| JSON-RPC code | Meaning |
|---|---|
| -32700 | Parse error (invalid JSON line) |
| -32600 | Invalid request envelope |
| -32601 | Unknown method |
| -32602 | Params failed zod validation (`data.code = VALIDATION`) |
| -32000 | Application error — `data: AppError` carries the real `ErrorCode` |

### 3.4 Versioning

`system.ping` returns `version`. Adding methods/notifications/optional fields is non-breaking. Renaming/removing requires an ADR and a coordinated UI+sidecar change in the same task.

## 4. Sidecar internals

```
apps/sidecar/src/
├─ main.ts                 # bootstrap, stdio loop
├─ container.ts            # composition root (manual DI, no framework)
├─ rpc/                    # RpcServer, method registry, notification bus
├─ validation/             # zod mirrors of schemas.ts
├─ domain/                 # pure logic: cost math, chunker, router state machine, verdict rules
├─ services/               # ChatService, LlmRouter, LedgerService, PricingService, FxService,
│                          # BudgetGuard, PnLService, RagService, PipelineOrchestrator,
│                          # WorkspaceWorker, VSCodeBridge, SettingsService, ProjectService
├─ providers/              # ILlmProvider impls: anthropic.ts, openai-compatible.ts, google.ts
│                          # IEmbeddingProvider impls; IImageProvider impls (M8)
├─ infra/                  # sqlite (drizzle schema + repos), lancedb, keychain, fs, process, http, clock
└─ scheduler/              # interval jobs (pricing, fx) with jitter + single-flight
```

- **Event bus:** typed `EventBus<RpcNotificationMap>` (Observer). Services publish; `RpcServer` forwards to stdout. Services never write to stdout directly.
- **Concurrency:** one pipeline run per project at a time (queue others); different projects run in parallel (D13). Chat requests are concurrent. SQLite in WAL mode; writes serialized through repositories.

## 5. LLM Router

### 5.1 Provider adapters (Strategy)

```ts
interface ILlmProvider {
  readonly id: ProviderId;
  complete(req: ProviderRequest, signal: AbortSignal): Promise<Result<ProviderResponse, ProviderFailure>>;
  stream(req: ProviderRequest, signal: AbortSignal, onDelta: (text: string) => void): Promise<Result<ProviderResponse, ProviderFailure>>;
  listModels(): Promise<Result<readonly string[], ProviderFailure>>;
}
interface ProviderFailure { kind: FailureKind; httpStatus?: number; retryAfterMs?: number; billed: boolean; message: string }
```

`ProviderRequest`/`ProviderResponse` are sidecar-internal (not in `schemas.ts`); each adapter maps from/to `LlmRequest`/`LlmResponse`, including tool declarations and tool-call parts. Adapters: `anthropic`, `openai-compatible` (OpenAI, xAI, Groq, Together via `baseURL`), `google`.

### 5.2 Failure classification (adapter responsibility)

| Signal | `FailureKind` | Fallback? | Same-model retry? |
|---|---|---|---|
| HTTP 429 + quota/billing code (e.g. `insufficient_quota`, `RESOURCE_EXHAUSTED` daily) or HTTP 402 | `quota_exhausted` | Yes | No — open circuit for `max(cooldownMs, 1h)` |
| HTTP 429 otherwise | `rate_limited` | Yes | Yes, if `retryAfterMs ≤ 10 s` |
| HTTP 500/502/503/504, 529 (overloaded), network reset | `server_error` | Yes | Yes |
| No first byte within `LadderEntry.timeoutMs` | `timeout` | Yes | Yes |
| HTTP 401/403 | `auth` | **No** — fail fast, `PROVIDER_AUTH`, remediation "re-enter key" | No |
| HTTP 400/422 | `bad_request` | **No** — bug in our request | No |
| Safety block | `content_filtered` | **No** — surface to user | No |
| Model lacks `requiredCapabilities` / no key configured | `capability_mismatch` | Skip silently | — |

### 5.3 State machine (per `LlmRequest`)

```
            ┌──────┐ dispatch()
            │ IDLE │──────────────┐
            └──────┘              ▼
                         ┌──────────────┐ hardStop && exceeded
                         │ BUDGET_CHECK │────────────────────────────► FAILED (BUDGET_HARD_STOP)
                         └──────┬───────┘
                                │ ok (warning ⇒ also emit budget.alert)
                                ▼
          ┌────────────► DISPATCHING(model[i]) ── first token ──► STREAMING ── done ──► SUCCEEDED
          │                     │                                     │
          │                     │ failure f                           │ failure f (mid-stream)
          │                     ▼                                     ▼
          │          ┌───────────────────────────────────────────────────────┐
          │          │ classify(f)                                           │
          │          │  non-fallback kind ──────────────────────────────────►│ FAILED
          │          │  retryable && retries < maxRetries ──► RETRY_WAIT ────┘─┐
          │          │  else ──► next eligible model exists?                 │ │
          │          │           no ─────────────────────────────────────────► FAILED (LADDER_EXHAUSTED)
          │          │           yes && autoFallback ──► FALLING_BACK ─┐     │ │
          │          │           yes && !autoFallback ─► AWAITING_USER │     │ │
          │          └─────────────────────────────────────┬───────────┼─────┘ │
          │                                                │           │       │
          │   use_model / retry_same ◄─────────────────────┘           │       │
          │   abort / timeout ─────────────────────────────► FAILED (FALLBACK_DECLINED)
          └─────────────────────────────────────────────────────────────┴───────┘
  cancel() from any non-terminal state ──► CANCELLED
```

- **Eligible model:** enabled, has secret, has all `requiredCapabilities`, circuit not open, not already failed in this request.
- **Model order:** `ladderOverride` (pipeline roles) → else `lockedModelKey` (if set) followed by ladder → else ladder by `priority`.
- **Backoff:** `min(retryAfterMs ?? 500·2^n, 10 s)` with ±20 % jitter.
- **Mid-stream fallback:** partial output is discarded; router emits `router.event{type:'fallback'}`; UI clears the partial bubble for that `requestId` and resumes rendering from the new stream. Tool calls are never executed from a partial stream.
- **Billing of failures:** if the adapter reports `billed=true` (e.g. stream died after tokens), a ledger row with `billedFailure=true` is written.
- **Circuit breaker:** per model; `failureThreshold` consecutive fallback-kind failures → OPEN for `cooldownMs` → HALF_OPEN (one probe request) → CLOSED on success. Emits `router.event{type:'circuit'}`.
- **Defaults:** ladder seeded from `config/models.seed.json`; `maxRetries=2`, `timeoutMs=30000` (first byte), circuit `3` failures / `120000` ms, `userDecisionTimeoutMs=120000`.

### 5.4 Settings UI contract

- Ladder list: drag-and-drop (dnd-kit) → `router.updateConfig` with renumbered priorities.
- Toggle **Auto Fallback** (`RouterConfig.autoFallback`), default **ON**.
- Lock-to-model dropdown (`lockedModelKey`) — also exposed in the Chat model dropdown as "Lock".
- Fallback modal (Auto OFF): lists `FallbackDecisionRequest.candidates` with estimated cost; buttons *Use*, *Retry same*, *Cancel*; countdown to `expiresAt`.

## 6. Cost, pricing, FX, budget, P&L

### 6.1 Cost computation (pure, `domain/cost.ts`)

```
cost = ceil( (input − cached)·inPrice + cached·cachedPrice + output·outPrice ) / 1_000_000   [µUSD; prices per MTok in µUSD]
image cost = imageCount · perImageMicroUsd
```
Integer math only. Price lookup by `modelKey` in the **current** `PriceTable`; the version is stored on the ledger row. Unknown model price → record with cost 0, flag `pricing.updated` warning "missing price for X" (never block the call).

### 6.2 Pricing updater (D9)

1. Triggered **only** by `pricing.refresh` (user clicks "Update prices", D9). The UI shows a reminder when the current table is older than 30 days. `PricingSettings.autoUpdate` defaults to `false` and is not exposed in the UI.
2. For each provider: fetch configured pricing URL(s) (`config/pricing.sources.json`) via HTTP GET, strip to text (HTML → text, max 200 KB).
3. LLM extraction through the router (`purpose = pricing_extraction`, `responseFormat = json`) with a fixed prompt (`ROLES.md` §2.5) → zod-validate into `PriceEntry[]`.
4. Validation: every known model present or explicitly omitted; all rates ≥ 0; `|Δ%| ≤ maxAutoChangePercent` (default 50) versus current; else `rejected_validation`.
5. Apply → new `PriceTable` version (`origin = auto_extracted`) → `pricing.updated`. Reject/fail → keep current, emit warning. Manual edits (`pricing.override`) create `origin = manual_override` versions and are preserved over auto updates for that model until the user clears them.

### 6.3 FX (D8)

- Fetch `usdToVnd` daily from `settings` FX URL (default `https://open.er-api.com/v6/latest/USD`, decided 2026-10-02). Plain HTTP GET — no LLM tokens. Manual override wins when non-null.
- `MoneyDisplay` built **only** in the sidecar (`domain/money.ts`): `usdText` = `$` + 4 decimals if < $1 else 2; `vndText` = vi-VN grouping, no decimals, suffix ` ₫`.
- UI component `<Money value={MoneyDisplay} />` renders two lines: USD (primary) / VND (secondary, muted).

### 6.4 Budget guard (D7)

- Before every paid call: `BudgetGuard.check(projectId, estimatedCost)`. Estimate = prompt tokens (tokenizer approx `chars/4`) × input price + `maxOutputTokens` × output price.
- Levels: `ok` < first `warnAt`; `warning` ≥ any threshold (emit `budget.alert` once per threshold per period); `exceeded` ≥ 1.0.
- `exceeded && hardStop` → reject with `BUDGET_HARD_STOP` (remediation: raise budget or disable Hard Stop). Running pipeline is stopped at the next call boundary and rolled back if in WRITING/VALIDATING.

### 6.5 P&L

`pnl.get` aggregates `ledger` and `revenue` tables for a range → `ProjectPnL` (by model, purpose, day). **Aggregate P&L (D13):** `pnl.getAll` (added in M3-07 together with its validator) returns one `ProjectPnL` per project plus a portfolio total, for the "All projects" dashboard. Live view: UI subscribes to `ledger.entry` and re-queries debounced (1 s).

## 7. RAG (Method 2)

### 7.1 Ingest pipeline

```
paths ─► discover files (ext allow-list, size ≤ 20 MB, skip .git/node_modules)
      ─► parse  (md/txt/code: raw · pdf: pdfjs-dist · docx: mammoth · html: readability→text)
      ─► sha256(content) ─ unchanged? ─► SKIPPED_UNCHANGED
      ─► chunk  (heading-aware for md/docx/html; symbol/line-window for code;
                 targetTokens 500, overlap 80; keeps sectionPath)
      ─► embed  (batched; via router-like EmbeddingDispatcher with fallback among
                 same-dimension models; metered, purpose = embedding)
      ─► LanceDB upsert (table per project: chunks_<projectId>), delete stale chunks of that doc
      ─► SQLite: SourceDocument row
```

Progress: `rag.progress` after each file. Failure on one file does not abort the job; job ends `failed` only if all files failed.

### 7.2 Retrieval

1. Embed query (same model as index; mismatch → re-index required error).
2. LanceDB cosine search topK×2 → drop `< minScore` → MMR re-rank to topK (diversity λ = 0.7).
3. Inject into the system prompt as numbered context blocks `[1] <title> › <sectionPath>` with instruction to cite `[n]`.
4. Response `citation` parts reference `RetrievalHit`; UI renders citation chips that open the chunk.
5. Also exposed as tool `search_knowledge` for agent roles.

### 7.3 Changing embedding model

Different `dimensions` ⇒ UI warns "full re-index required" and re-ingests all documents of the project as one job.

## 8. Runtime agent pipeline

### 8.1 Stages

```
SPECIFYING (PM) ─► CODING (Coder) ─► REVIEWING (Reviewer)
                                        │ approved ─────────────────────────────┐
                                        │ rejected, fixAttempts=0               │
                                        ▼                                       │
                                     FIXING (Coder, with findings)              │
                                        ▼                                       │
                                     RE_REVIEWING ─ rejected ─► FAILED          │
                                        │ approved                              │
                                        ▼                                       ▼
                                     WRITING (Worker transaction) ─ conflict/IO error ─► ROLLED_BACK
                                        ▼
                                     VALIDATING (allow-listed commands) ─ any fail ─► ROLLED_BACK
                                        ▼
                                     COMPLETED
```

- Every role call goes through the router with `ladderOverride = roleAssignment[role]` and fallback per `autoFallback`.
- Role outputs are JSON (`TaskSpec`, `CoderOutput`, `ReviewVerdict`), zod-validated. Invalid JSON → one automatic re-ask with the validation error; second failure → FAILED.
- **Context given to roles:** PM gets prompt + RAG hits + project file tree (depth 4, ignore list) + `CONVENTIONS` summary. Coder gets `TaskSpec` + current content and `sha256` of each `allowedPaths` file. Reviewer gets `TaskSpec` + `CoderOutput` + rendered diffs.
- **Verdict rule (enforced in code, not trusted to the model):** `approved` is forced to `false` if any finding is `blocker`/`major`.
- `FAILED` before WRITING changes nothing on disk; the `FailureReport` includes reviewer findings.
- Cancel: before WRITING → stop; during WRITING/VALIDATING → rollback.

### 8.2 Failure report

Built by `FailureReportBuilder` from stage + `AppError` + last 60 lines of relevant logs; `nextSteps` from a remediation table keyed by `ErrorCode` (e.g. `PATCH_CONFLICT` → "A file changed while the pipeline ran. Save or discard your edits in VS Code, then re-run."). Shown in the Code tab and pushed via `pipeline.failureReport`.

## 9. Workspace Worker

### 9.1 Path safety

`resolveSafe(root, rel)`: reject absolute paths, `..` segments, drive letters, UNC, NUL bytes, and symlinks escaping root (realpath check). Must also be in `TaskSpec.allowedPaths` (exact or directory prefix). Never write into `.git/`, `.itstudio/` (except journal), `node_modules/`.

### 9.2 Transaction protocol (atomic multi-file write)

1. **Prepare:** validate all ops; verify `baseHash` against current file (mismatch → `PATCH_CONFLICT`, abort, nothing written); apply patches in memory; create journal `.itstudio/tx/<id>/manifest.json` (`status: prepared`, op list, original existence flags) + copy originals to `.itstudio/tx/<id>/orig/<path>`; fsync.
2. **Commit:** for each op write to `<path>.itstudio-tmp` → fsync → rename over target (deletes/renames last); update manifest `status: committed`.
3. **Validate:** run `pipeline.validationCommands` sequentially; parse output into `Diagnostic[]` / `TestSummary`.
4. **Finalize:** success → `status: validated`, delete `orig/` (keep manifest 7 days). Failure → **rollback**.

### 9.3 Rollback

Restore every `orig/` file, delete files that did not exist before, revert renames; verify hashes; `status: rolled_back`. Any step failing → `ROLLBACK_FAILED` with `nextSteps` listing exact journal paths for manual recovery.

### 9.4 Crash recovery

On sidecar start, scan every project's `.itstudio/tx/*/manifest.json`; any `prepared` or `committed` (not `validated`) transaction is rolled back and a `FailureReport` is queued for the UI.

### 9.5 Command runner

- Commands come only from `PipelineSettings.validationCommands` (defaults in `config/commands.default.json`: tsc, eslint, vitest via their JS entry points). `executable: "node"` resolves to `process.execPath`; `executable: "npm"` resolves to `process.execPath` + `<node dir>/node_modules/npm/bin/npm-cli.js` (Windows forbids spawning `.cmd` files with `shell:false`). Executed with `spawn(executable, args, { shell: false, cwd: root })`, env stripped of all provider secrets, timeout per spec, output tail 64 KB.
- Parsers: tsc (`file(line,col): error TSxxxx: msg`), eslint (`--format json`), vitest (`--reporter=json`).

## 10. VS Code bridge & companion extension

### 10.1 Launch & connect

1. Sidecar starts WS server on `127.0.0.1:0` (random port); generates 32-byte random token per sidecar session.
2. On project activation, writes `.itstudio/session.json` `{ port, token, protocolVersion: 1 }` (and ensures `.itstudio/` is in the project's `.gitignore`).
3. Ensures extension installed: `code --list-extensions` → if missing/outdated → `code --install-extension <bundled .vsix> --force`.
4. Launches `code <workspaceRoot>` (`shell:false`). Extension activates on `workspaceContains:.itstudio/session.json`, reads it, connects, sends `ExtHello`.
5. Sidecar validates token (constant-time compare) and rejects any connection with an `Origin` header (blocks browser pages). On success: `welcome`, `vscode.status{connected:true}`.

### 10.2 Behaviour

| Sidecar → Ext | Extension action |
|---|---|
| `transaction{committed}` | If `revealChangedFiles`: open first changed file; decorate changed ranges |
| `show_diff` | `vscode.diff` with virtual documents (before/after) |
| `reveal` | Open file at line |
| `notify` | `showInformation/Warning/ErrorMessage` |
| `request_diagnostics` | Reply with `diagnostics` from `vscode.languages.getDiagnostics()` for the workspace |

| Ext → Sidecar | Sidecar action |
|---|---|
| `diagnostics` (also pushed on change, debounced 500 ms) | Forward as `vscode.diagnostics`; attached to running `PipelineRun` as supplemental info (Worker results remain authoritative) |
| `file_saved_by_user` | If a pipeline is between CODING and WRITING and the path is in `allowedPaths`, mark run stale → `PATCH_CONFLICT` at prepare |

Heartbeat: `ping` every 15 s; 2 missed → disconnected. VS Code closed or not installed → app keeps working (`VSCODE_UNAVAILABLE` is a warning, never a pipeline failure).

### 10.3 Extension layout

`apps/vscode-ext/` — `package.json` (activationEvents, no UI contributions besides a status bar item "IT Studio: connected"), `src/extension.ts`, `src/bridge.ts`, `src/diff.ts`. Bundled with esbuild; packaged with `@vscode/vsce` into the app resources.

## 11. Security model

| Threat | Control |
|---|---|
| Key leakage | Keychain only (`@napi-rs/keyring`); keys loaded per call, never cached in plain module state longer than the request; pino redaction paths for `apiKey`, `authorization`, `x-api-key`; secrets stripped from child-process env; `secrets.*` RPC is write-only. |
| XSS via model output | Markdown rendered with `react-markdown` + `rehype-sanitize` (default schema, no raw HTML); no `dangerouslySetInnerHTML`; links open externally via Tauri opener with `rel=noopener`; strict CSP (`default-src 'self'; img-src 'self' data: asset:`; no remote scripts). |
| SQL injection | Drizzle query builder / parameterized statements only; raw SQL forbidden outside migrations. LanceDB filters built from whitelisted fields, values escaped by API. |
| Path traversal / arbitrary write | §9.1 `resolveSafe` + `allowedPaths`. |
| Command injection / RCE | Allow-listed commands only, `shell:false`, no model-supplied commands or args. |
| Prompt injection from RAG docs / repo files | Retrieved text wrapped in delimited, labelled blocks; roles instructed that context is data; Worker enforces safety regardless of model output (defence in depth). |
| Local WS hijack | Loopback bind, per-session token, Origin rejection, protocol version check. |
| Supply chain | Lockfile committed; `npm audit` in CI task; no postinstall scripts from unknown packages without review. |

## 12. Persistence

### 12.1 SQLite tables (Drizzle, `infra/sqlite/schema.ts`)

`projects`, `settings` (single row JSON, validated), `conversations`, `messages` (parts JSON), `ledger_entries` (indexed by `project_id, occurred_at`), `revenue_entries`, `budgets`, `price_tables` (version, effective_from, origin, entries JSON), `price_update_runs`, `fx_rates`, `source_documents`, `ingest_jobs`, `pipeline_runs` (artifacts JSON), `image_assets` (M8). Migrations via drizzle-kit, forward-only.

### 12.2 Files

```
%APPDATA%/com.itstudio.app/
├─ itstudio.db          # SQLite (WAL)
├─ vectors/             # LanceDB
├─ images/              # M8
└─ logs/sidecar-YYYYMMDD.log  (7-day rotation)
<project>/.itstudio/    # session.json, tx/ journals (gitignored)
```

## 13. Observability

- pino JSON logs (stderr + file), fields: `ts, level, svc, projectId, requestId, runId, msg`. Default level `info`.
- Every router attempt logs model, latency, outcome, failure kind (never prompt bodies at `info`).
- Settings → "Open logs folder".

## 14. Deferred components (specified, not implemented in v1)

### 14.1 Image generation — M8

- `IImageProvider { id: ImageProviderId; generate(req: ImageGenerationRequest, signal): Promise<Result<GeneratedImage[]>> }` (`GeneratedImage` = sidecar-internal `{ bytes, mimeType, revisedPrompt? }`, persisted as `ImageAsset`). Adapters: `openai_dalle3`, `flux_together`, `flux_replicate` (poll prediction until done, timeout 120 s), `midjourney_proxy` (compiled but disabled; enabling requires ADR + user consent re ToS).
- Tool `generate_image` (`ToolDeclaration.enabled = settings.image.enabled`). Flow: model emits tool call → validate `GenerateImageArgs` → BudgetGuard (cost = `perImageMicroUsd × count`) → provider ladder `settings.image.providerOrder` with fallback → download bytes immediately (remote URLs expire) → store in `images/` → `ImageAsset` row → ledger (`purpose = image`) → tool result `{assetIds}` → chat renders `image` parts via Tauri asset protocol.
- Gallery tab: grid of `ImageAsset` by project, prompt + revised prompt + cost, open folder, delete.

### 14.2 Packaging & distribution — M9

- Sidecar bundled with esbuild into one JS file, then into a Node **Single Executable Application** (`node --experimental-sea-config`) named `itstudio-sidecar-x86_64-pc-windows-msvc.exe`, registered as Tauri `externalBin`. Native modules (better-sqlite3, LanceDB, keyring) shipped as `.node` files in `resources/` and loaded via absolute path; verify each at startup.
- Tauri bundler: NSIS installer (`.exe`) + MSI; per-user install; WebView2 bootstrapper embedded.
- Bundled resources: `itstudio-vscode.vsix`, `config/*.seed.json`.
- Code signing (Authenticode cert — user to supply), Tauri updater with signed update manifests (key pair generated in M9, private key kept out of repo).
- Release checklist: version bump in 4 manifests (root, desktop, sidecar, ext) via script; CHANGELOG release section; smoke test on clean Windows VM.
- macOS (`.dmg`) and Linux (`.AppImage`) targets: out of scope until requested.

---

# Part II — v2: Multi-Agent & Omnichannel Orchestration Hub (after v1 = M0–M7)

> Decisions D18–D23 (CONTEXT §3), ADR-0003. Types: `schemas.ts` §14–§16. Built in M10–M14.
> **Operating principle (D21): nothing runs in the background.** Every agent run, channel sync and LLM call is started by a user action (button, chat message, VS Code command). No timers, no polling loops for channels.

```
                 ┌──────────── Channel Adapters (IChannelAdapter) ────────────┐
 User actions ──►│  app (UI)   vscode (chat panel)   gmail   facebook_page     │
                 └──────┬──────────────┬───────────────┬──────────┬──────────┘
                        │ AgentRequest │               │ sync()   │ sync()      (user clicks "Sync")
                        ▼              ▼               ▼          ▼
                 ┌──────────────────────────────────────────────────────────┐
                 │ Agent Orchestrator                                        │
                 │  AgentRegistry · RoutingRules · AgentRunner (tool loop)   │
                 │  → LlmRouter (ladder per agent) → Ledger (purpose agent)  │
                 └──────┬───────────────────┬──────────────────────┬────────┘
                        ▼                   ▼                      ▼
                  Agent Memory        RAG (knowledge)        Outbox (approval queue)
                  LanceDB+SQLite       LanceDB                ── user approves ──► adapter.send()
```

## 15. Agent Orchestrator (M10)

### 15.1 Agents

- `AgentDefinition` rows in SQLite (`agents` table, JSON body validated by zod). Built-in templates seeded from `config/agents.seed.json`: **PM, Architect, Coder, QA, Email Assistant, Page Support** (`builtIn: true` — clone-to-edit, cannot delete). Users create `custom` agents in **Settings → Agents** (Agent Builder: name, persona prompt, model ladder, tools, channels, memory policy).
- The v1 runtime pipeline (§8) is re-expressed as a **team workflow**: PM → Coder → Reviewer(QA) agents with the same stage machine; `RoleAssignment` maps to the agents' `modelLadder`. Behaviour of §8 is unchanged.
- Safety rules from ROLES §2 "common rules" are always appended to every agent system prompt (not editable).

### 15.2 AgentRunner (one turn)

```
AgentRequest{agentId, projectId, input, trigger}
  → BudgetGuard
  → build context: system prompt + recalled memories (§16.3) + optional RAG hits + conversation history (last N turns, token-capped)
  → LlmRouter.dispatch(ladderOverride = agent.modelLadder, tools = agent.tools ∩ allowed-for-trigger)
  → tool loop (max 6 tool calls per run): search_knowledge | recall_memory | remember | draft_reply | start_pipeline | generate_image(M8)
  → result message + AgentRun record + ledger rows (purpose = agent)
  → if autoExtract: queue memory extraction for when the conversation is closed (§16.2)
```

- **Trigger restrictions:** runs whose input came from an external channel (`EXTERNAL_CHANNELS`) may only use `search_knowledge`, `recall_memory`, `draft_reply`. They can never `start_pipeline`, `remember` from untrusted text, or send anything directly (prompt-injection containment, D22).
- `draft_reply` creates an `OutboxItem{status: pending_approval}` — it never sends.

### 15.3 Routing

`RoutingRule[]` (ordered) map an inbound `ChannelMessage` to an agent when the user clicks **Process** on a message (or "Process all untriaged"). No match → account's `defaultAgentId` → else ask the user to choose.

### 15.4 Cost

Ledger purposes added in M10: `agent`, `memory_extraction`, `triage`. Every run's cost is shown on the run and rolls into project P&L.

## 16. Agent Memory (M11)

### 16.1 Storage

- SQLite `memories` (metadata = `MemoryItem`) + LanceDB table `memories_<agentId>` (vector + id). Same embedding model as RAG (`settings.rag.embedding`).
- Scope: `(agentId, projectId)`; `projectId = null` = agent-global. Recall includes global items only if `memory.shareAcrossProjects`.

### 16.2 Write paths

| Path | When | Cost |
|---|---|---|
| **Auto-extract** | When a user-driven conversation is closed / switched away / app exit, if `autoExtract` and ≥ 2 user turns | 1 cheap LLM call (extraction prompt ROLES §2.8) + embeddings |
| **Explicit** | User says "remember …", clicks *Remember* on a message, or agent tool `remember` (non-external triggers only) | embeddings only |
| **Manual** | Memory page: add / edit | embeddings only |

- External-channel content is extracted only when the agent's `extractFromExternalChannels` is true (default **false**).
- **De-duplication:** new item with cosine ≥ 0.92 to an existing item of the same agent/scope → update the existing item (merge text, max importance) instead of inserting.
- **Secret filter:** reject items matching the secret-scanner patterns (`scripts/scan-secrets.mjs` regex set) or containing email/phone of third parties when source is external.

### 16.3 Recall

`score = cosine × (0.6 + 0.1·importance) × recencyDecay`, `recencyDecay = 0.5^(daysSinceLastUseOrCreate / 90)`; pinned items always included (max 5); top `recallTopK` (default 6) above cosine 0.3. Injected as a `<context name="memory">` block (data, not instructions). `lastRecalledAt` updated.

### 16.4 User control (Memory page)

List/search by agent & project, filter by kind; edit text/importance/expiry; pin; delete (removes vector + row); "Forget everything for this agent"; export JSON. Maintenance (purge expired, re-embed after model change) runs only when the user opens the page and clicks *Clean up*.

## 17. Channels & Outbox (M12–M14)

### 17.1 Adapter port

```ts
interface IChannelAdapter {
  readonly kind: ChannelKind;
  connect(accountInput): Promise<Result<ChannelAccount>>;          // OAuth / token entry
  disconnect(accountId): Promise<Result<void>>;                     // deletes keychain tokens
  sync(accountId, since?: IsoDateTime): Promise<Result<readonly ChannelMessage[]>>;  // user-triggered only; no LLM
  send(item: OutboxItem): Promise<Result<{ externalMessageId: string }>>;            // only called by OutboxService after approval
}
```

- `ChannelService.sync(accountId)` is invoked by RPC from a user action only. Fetched messages are stored (`channel_messages` table) with `triage = untriaged`. **Fetching costs no LLM tokens.**
- Triage/summaries happen only when the user clicks **Triage** (batch, cheapest JSON model, purpose `triage`).

### 17.2 Outbox (approval queue, D22)

`OutboxItem` lifecycle: `pending_approval` → (user edits) → **Approve & send** → `sent` | `failed`; or `rejected`; Facebook items past `sendBefore` → `expired`. UI: **Inbox** tab with two panes (Inbound / Outbox), badge counts. Sending is the only code path that calls `adapter.send`, and it requires an RPC from the UI with the item id.

### 17.3 App channel (built-in)

The existing Chat tab becomes "chat with an agent": agent picker in the chat header (default agent per project).

### 17.4 VS Code channel (M12)

Webview **chat panel** in the companion extension (re-uses the M7 WebSocket bridge, new message types): agent picker, send selected code / current file as context, shows streamed replies, "Start pipeline from this" button. Same memory, ledger and project as the app. Protocol additions are versioned (`protocolVersion: 2`).

### 17.5 Gmail (M13)

- **Auth:** OAuth 2.0 installed-app flow with PKCE + loopback redirect (`http://127.0.0.1:<random>/callback`); user supplies their own Google Cloud OAuth client id (Desktop app type). Scopes: `gmail.modify` (read, label), `gmail.send`. Refresh token in keychain.
- **Sync:** Gmail API `users.history.list` from stored `historyId` (fallback `messages.list q=newer_than:7d in:inbox`); bodies converted to plain text; attachments not downloaded (names only).
- **Triage:** labels `ITStudio/Urgent|Action|FYI` applied after the user confirms triage results.
- **Draft replies:** `draft_reply` → Outbox; on approve → `messages.send` with correct `threadId`, `In-Reply-To`, `References`.
- **Email commands (D23):** a message is a command only if `From` ∈ `commandSenders` (default: the account's own address) **and** subject starts with `[ITS]`. Commands are processed at the next user-triggered sync, run as `trigger: channel_action`, may create tasks/pipeline runs only after an in-app confirmation, and the result is drafted to the Outbox as a reply. Sender headers are checked against SPF/DKIM `Authentication-Results: … dkim=pass` to reduce spoofing.
- **Email reports:** "Email me this report" buttons (P&L, pipeline failure report, overnight summary) create an Outbox item addressed to the user's own address (still approved by one click).

### 17.6 Facebook Page (M14)

- **Auth:** user creates a Meta app, grants `pages_messaging`, `pages_read_engagement`, `pages_manage_metadata`; pastes a long-lived **Page access token** (stored in keychain). No personal-account automation (ToS).
- **Sync:** Graph API `/{page-id}/conversations?fields=messages{message,from,created_time}` since last sync (user-triggered; no webhook, no tunnel).
- **Reply:** Send API `POST /{page-id}/messages` with `messaging_type: RESPONSE`; only within **24 h** of the customer's last message — Outbox item gets `sendBefore`, expired items are blocked with remediation text.
- Rate limits respected via `x-business-use-case-usage` header → backoff.

### 17.7 Security additions

| Threat | Control |
|---|---|
| Prompt injection via email/Messenger | External triggers get a restricted tool set; untrusted content wrapped in `<context source="external">`; no direct send; memory extraction off by default for external sources. |
| Email command spoofing | Allow-listed sender + `[ITS]` subject + DKIM pass + in-app confirmation for any action with side effects. |
| Token theft | OAuth refresh tokens / page tokens only in keychain; redaction list extended; `channels.*` RPC never returns tokens. |
| Accidental mass sending | Outbox approval required for every item; "approve all" disabled for external channels; max 20 sends per hour per account. |
| PII in memory | Secret/PII filter; Memory page delete/export; per-agent "forget everything". |

---

# Part III — v3: Agentless Infrastructure Management (after v2 = M10–M14)

> Decisions D24–D30 (CONTEXT §3), ADR-0004. Types: `schemas.ts` §17. Built in M15–M19.
> Agentless: nothing is installed on the managed hosts. Everything runs over one SSH connection per server (`ssh2`): exec channels for metrics/actions, SFTP subsystem for files, `docker system dial-stdio` for the Docker API.

```
React: Servers tab ── ServerCard grid · AddServerModal · ContainerDrawer · RemoteFileManager
   │ JSON-RPC (server.*, docker.*, sftp.*)            ▲ notifications: server.metrics, server.status, server.alert, docker.log
   ▼                                                  │
Sidecar ── SshConnectionManager (pool, keepalive, reconnect, host-key pinning)
            ├─ MetricsCollector  (per-OS Strategy: Linux /proc · macOS sysctl/vm_stat · Windows PowerShell CIM)
            ├─ AlertEngine       (rules, debounce, toast / OS notification)
            ├─ DockerManager     (dockerode over SSH dial-stdio)
            ├─ SftpService       (browse, read, diff-checked write + backup, upload/download)
            └─ SystemActionService (reboot/shutdown per OS, audit log)
                          │ ssh (key auth, keepalive 15 s)
                          ▼
            Dell home-lab (Tailscale IP) · VPS (public IP) · Windows Server · macOS
```

## 18. SSH foundation (M15)

### 18.1 Server registry

`servers` table (`ServerConfig`). AddServerModal fields: name, host, port (22), username, private key file (+ optional passphrase), tags. The private key is never sent to the webview: the UI passes the selected **file path**; the sidecar reads, validates (OpenSSH/PEM, ed25519/ECDSA/RSA) and stores it.

### 18.2 Key vault (Windows Credential Manager size limit ≈ 2.5 KB)

- Generate a random 256-bit data key per server → store in keychain (`itstudio-ssh/<serverId>`).
- Encrypt the private key (AES-256-GCM, random IV) → `<dataDir>/ssh/<serverId>.key.enc`. Passphrase (if any) stored in keychain as a separate entry.
- Decrypted key exists only in memory for the duration of the handshake; buffers are zeroed afterwards.
- Delete server → delete both keychain entries and the encrypted file.

### 18.3 Host key verification (TOFU)

First connect: show SHA-256 fingerprint → user confirms → pinned in `hostKeyFingerprint`. Subsequent mismatch → state `host_key_mismatch`, connection refused, remediation explains how to re-pin after verifying the server.

### 18.4 SshConnectionManager

- One `ssh2` Client per server, lazily opened, shared by all services (multiplexed channels). Keepalive 15 s; reconnect with backoff 1→2→4→…→60 s while a consumer still needs the connection.
- Reference counting: consumers (`metrics`, `docker`, `sftp`, `logs`) acquire/release; idle connections close after 60 s with zero consumers.
- OS detection on first connect: `uname -s` (Linux/Darwin) else PowerShell `$PSVersionTable.OS` → `ServerOs`.
- Commands executed only from a fixed, per-OS command catalog (no user/model-supplied shell strings) — same rule as §9.5.

## 19. Metrics & monitoring (M16)

### 19.1 Collectors (Strategy per OS; one combined exec per poll)

| Metric | Linux | macOS | Windows (PowerShell) |
|---|---|---|---|
| CPU | `/proc/stat` delta (busy/total) + `/proc/loadavg` | `top -l 1 -n 0` CPU line + `sysctl -n vm.loadavg` | `Get-CimInstance Win32_Processor` LoadPercentage |
| Memory | `/proc/meminfo` (MemTotal − MemAvailable) | `vm_stat` + `sysctl hw.memsize` | `Win32_OperatingSystem` Total/FreePhysicalMemory |
| Network | `/proc/net/dev` (exclude `lo`, `docker*`, `veth*`) delta | `netstat -ib` delta | `Get-NetAdapterStatistics` delta |
| Disk | `df -kP` (real filesystems) | `df -kP` | `Get-CimInstance Win32_LogicalDisk` |
| Battery | `/sys/class/power_supply/BAT*/{capacity,status}` | `pmset -g batt` | `Win32_Battery` |
| Uptime | `/proc/uptime` | `sysctl -n kern.boottime` | `Win32_OperatingSystem` LastBootUpTime |

Output is a delimited block parsed by a pure parser per OS (`domain/metrics/*`), fully unit-tested with captured fixtures. Rates computed from the previous sample (first sample → 0).

### 19.2 Monitoring modes (D25)

- **Default (`backgroundMonitoring = false`):** polling runs only while the Servers tab (or a server card / drawer) is visible — the UI calls `server.watch(serverIds)` on mount and `server.unwatch` on unmount/hidden (Page Visibility API). No polling otherwise.
- **Background (`true`):** all servers polled every `pollIntervalSeconds` while the app runs; AlertEngine evaluates rules on every sample.
- Interval 3–60 s (default 5). Polls never overlap (single-flight per server); a poll exceeding 10 s marks the sample late.
- In-memory ring buffer of the last 10 minutes per server for sparklines; no persistence of metrics history in v3.

### 19.3 Alerts

Default rules: offline > 30 s, CPU > 90 % for 120 s, RAM > 90 % for 60 s, disk > 90 %, battery < 15 % while discharging, container exited unexpectedly (Docker events). Fired/resolved alerts → `server.alert` notification → in-app toast + alert list; OS notification via Tauri notification plugin if `osNotifications`. Alerts only fire in background mode or while watched. (Email alerts via v2 Outbox are a later option.)

### 19.4 Server Card UI

Header (name, host, status badge green/red/amber, uptime) · RAM bar (amber ≥ 80 %, red ≥ 90 %, using theme status tokens) · CPU sparkline (last 10 min) · Net ↑/↓ (auto KB/s–MB/s) · disk bars · battery widget only when `battery != null` · actions menu (Containers, Files, Reboot, Shutdown). Colors come from theme tokens (THEMES.md).

## 20. Docker management (M17)

- `DockerManager` creates a `dockerode` instance whose transport is an SSH exec channel running `docker system dial-stdio` (works on Linux, macOS, Windows hosts with Docker CLI ≥ 18.09). No socket forwarding, no ports opened. The SSH user must be allowed to use Docker (docker group / Docker Desktop) — surfaced as `dockerAvailable=false` with remediation otherwise.
- Operations: list (all/running), inspect, start/stop/restart (stop timeout 10 s), Docker events subscription (container die/start → alerts + UI refresh).
- **Log streaming:** `docker.logs.open(containerId, {tail: 500, follow: true})` → `LogStreamId`; chunks pushed as `docker.log` notifications (≤ 64 KB, ≤ 20 chunks/s with coalescing; drop-oldest when the UI falls behind and notify). `docker.logs.close` on drawer close; streams auto-close when the UI disconnects.
- **ContainerDrawer:** table (name, image, ports, state chip), Start/Stop/Restart buttons (Stop/Restart confirm when the container exposes ports), log viewer: virtualized list (react-virtuoso), auto-scroll toggle, text filter, stdout/stderr toggle, download visible log.

## 21. Remote file manager (M18)

- `SftpService` over the shared connection: `list(path)`, `stat`, `read(path)` (≤ 5 MB in editor; larger → download only), `download` (to a user-chosen local path via save dialog), `upload` (local file → remote dir, overwrite confirm), `mkdir`, `rename`, `delete` (confirm; no recursive delete in v3).
- **Safe edit (D27):** open returns content + `sha256`; save sends `RemoteFileWriteRequest{baseSha256}` → sidecar re-reads and compares hash (mismatch → `CONFLICT`, UI shows 3-way choice) → writes backup `<file>.itstudio-bak-<YYYYMMDDHHmmss>` (same dir) → writes to `<file>.itstudio-tmp` → rename over target (atomic on POSIX; Windows uses replace semantics) → returns new hash. **Undo** restores the latest backup. Diff (Monaco diff editor) is shown before every save.
- Binary detection (NUL bytes) → editor disabled. Line endings preserved.
- UI: dual pane (directory tree / file list with size, mtime, mode), breadcrumbs, Monaco editor with language by extension (`.env`, YAML, JSON, Dockerfile, nginx conf…).

## 22. System actions (M19)

| OS | Reboot | Shutdown |
|---|---|---|
| Linux | `sudo -n systemctl reboot` | `sudo -n systemctl poweroff` |
| macOS | `sudo -n shutdown -r now` | `sudo -n shutdown -h now` |
| Windows | `shutdown /r /t 5` | `shutdown /s /t 5` |

- `sudo -n` never prompts: requires a passwordless sudoers rule limited to these commands (setup guide `docs/guides/server-setup.md` shows the exact `visudo` line). Failure → remediation with that line.
- Confirmation modal requires typing the server name. Every action is appended to an audit log (`server_actions` table: who/when/server/action/result).
- After reboot: server card shows "rebooting", connection manager retries until online or 10 min timeout.

## 23. Deferred: AI agents on servers (v3+, not scheduled)

Recorded per user request: v2 agents may later get server tools — read-only (`server_metrics`, `container_list`, `container_logs_tail`) and approval-gated actions (`container_restart`, `remote_file_edit` via diff) — never reboot/shutdown. Requires a new ADR before implementation.

## 24. v3 security additions

| Threat | Control |
|---|---|
| Private key theft | Encrypted at rest (AES-GCM) with keychain-held data key; never sent to webview/logs; zeroed after use. |
| MITM / server spoofing | Host-key pinning (TOFU) with hard failure on mismatch. |
| Command injection on hosts | Fixed per-OS command catalog; parameters (container ids, paths) validated and passed via APIs (dockerode, SFTP), never interpolated into shell strings. |
| Destructive actions | Typed-name confirmation, audit log, no recursive delete, backups before every file write. |
| Docker = root equivalence | Documented in setup guide; Docker access is opt-in per server (dockerAvailable check). |
