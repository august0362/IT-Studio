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
2. Sidecar: load config → open SQLite + run migrations → open LanceDB → **recover journals** (§9.4) → start scheduler (pricing, FX) → start VSCodeBridge WS server → emit notification `system.ready` (`RpcNotificationMap`).
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
- **Concurrency:** one pipeline run per project at a time (queue others). Chat requests are concurrent. SQLite in WAL mode; writes serialized through repositories.

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

1. Scheduler every `updateIntervalHours` (default 24) or `pricing.refresh`.
2. For each provider: fetch configured pricing URL(s) (`config/pricing.sources.json`) via HTTP GET, strip to text (HTML → text, max 200 KB).
3. LLM extraction through the router (`purpose = pricing_extraction`, `responseFormat = json`) with a fixed prompt (`ROLES.md` §2.5) → zod-validate into `PriceEntry[]`.
4. Validation: every known model present or explicitly omitted; all rates ≥ 0; `|Δ%| ≤ maxAutoChangePercent` (default 50) versus current; else `rejected_validation`.
5. Apply → new `PriceTable` version (`origin = auto_extracted`) → `pricing.updated`. Reject/fail → keep current, emit warning. Manual edits (`pricing.override`) create `origin = manual_override` versions and are preserved over auto updates for that model until the user clears them.

### 6.3 FX (D8)

- Fetch `usdToVnd` daily from `settings` FX URL (default open FX API, Q-03). Manual override wins when non-null.
- `MoneyDisplay` built **only** in the sidecar (`domain/money.ts`): `usdText` = `$` + 4 decimals if < $1 else 2; `vndText` = vi-VN grouping, no decimals, suffix ` ₫`.
- UI component `<Money value={MoneyDisplay} />` renders two lines: USD (primary) / VND (secondary, muted).

### 6.4 Budget guard (D7)

- Before every paid call: `BudgetGuard.check(projectId, estimatedCost)`. Estimate = prompt tokens (tokenizer approx `chars/4`) × input price + `maxOutputTokens` × output price.
- Levels: `ok` < first `warnAt`; `warning` ≥ any threshold (emit `budget.alert` once per threshold per period); `exceeded` ≥ 1.0.
- `exceeded && hardStop` → reject with `BUDGET_HARD_STOP` (remediation: raise budget or disable Hard Stop). Running pipeline is stopped at the next call boundary and rolled back if in WRITING/VALIDATING.

### 6.5 P&L

`pnl.get` aggregates `ledger` and `revenue` tables for a range → `ProjectPnL` (by model, purpose, day). Live view: UI subscribes to `ledger.entry` and re-queries debounced (1 s).

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

- Commands come only from `PipelineSettings.validationCommands` (defaults in `config/commands.default.json`: `npm run typecheck`, `npm run lint`, `npm test -- --run`). Executed with `spawn(executable, args, { shell: false, cwd: root })`, env stripped of all provider secrets, timeout per spec, output tail 64 KB.
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
