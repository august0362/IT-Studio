# CONTEXT.md — Single Source of Truth

> **Lost context? Read this file top to bottom first.** It is authoritative over every other document.
> If another file contradicts this one, this file wins and the contradiction must be logged as a bug in `ROADMAP.md` → *Doc Debt*.

| Field | Value |
|---|---|
| Product | **IT Studio** — Desktop Multi-Agent Command Center |
| Doc owner | Architect role (Claude) |
| Last updated | 2026-10-01 |
| Status | Specification complete · Implementation not started (see `ROADMAP.md`) |

---

## 1. What we are building (one paragraph)

A Windows-first desktop app (Tauri + React) through which **one user** chats with many LLMs from one box, grounds answers in their own documents (RAG), and issues natural-language build requests that an **in-app agent pipeline** (PM → Coder → Reviewer → Worker) turns into real code written to a project folder. The user only ever interacts with the app UI; **VS Code runs automatically alongside** as a live viewer driven by a companion extension. Every token and every cent is metered into a ledger that powers a real-time **cost and Profit & Loss** dashboard (USD + VND). Model calls go through a **resilient router** with a priority ladder and fallback on rate limits / quota exhaustion.

## 2. Two pipelines — do not confuse them

| | **Development pipeline** (how IT Studio itself is built) | **Runtime pipeline** (a feature inside IT Studio) |
|---|---|---|
| Who | Claude (Claude Code CLI) + Codex (Codex CLI) | Models called via API from the app |
| Spec / Plan / QA | Claude — writes docs, task files, reviews, runs tests | PM role (default Claude API) |
| Code | Codex, driven by Claude via `codex exec` | Coder role (default Codex-class model via OpenAI API) |
| Review | Claude | Reviewer role (default Claude API) |
| Writes files | Codex (in this repo) | Node Worker (atomic, journaled) into the user's project |
| Validate | Claude runs tsc / lint / tests | Worker runs allow-listed commands; VS Code ext shows diagnostics |
| Failure | git reset to checkpoint + report to user (Vietnamese) | Journal rollback + `FailureReport` shown in UI |
| Defined in | `ROLES.md` §1, `AGENTS.md` | `ROLES.md` §2, `ARCHITECTURE.md` §8 |

**DeepSeek is not used anywhere.**

## 3. Locked decisions

Changing any row requires an ADR in `docs/decisions/` and user approval.

| ID | Decision | Rationale |
|---|---|---|
| D1 | All core logic (router, pipeline, RAG, ledger, pricing, worker) lives in a **Node.js sidecar**. Tauri (Rust) is a thin shell that spawns/supervises the sidecar and relays **JSON-RPC 2.0 (NDJSON over stdio)**. One shared contract file: `src/types/schemas.ts`. | Single language (TS) for all logic; one schema; Codex works in one ecosystem. |
| D2 | API keys stored in the **OS keychain** (Windows Credential Manager) by the sidecar. Keys never reach React, logs, DB, or disk. | A UI bug cannot leak keys. |
| D3 | **VS Code companion extension ships in v1.** App auto-launches VS Code on the project; extension connects to the sidecar over `ws://127.0.0.1:<port>` with a per-session token; reveals changed files, shows diffs, streams diagnostics back. The Worker still runs build/lint/test headlessly and is the **source of truth** for pass/fail. | User never touches VS Code; validation does not depend on VS Code being open. |
| D4 | Storage: **SQLite** (better-sqlite3 + Drizzle) for chats, settings, projects, ledger, prices; **LanceDB** (embedded, local files) for RAG vectors; embeddings computed via **API** (OpenAI / Gemini), cost recorded in the ledger. | Zero servers, zero setup, offline-capable storage. |
| D5 | Runtime pipeline role defaults: **PM = Claude, Coder = Codex-class, Reviewer = Claude**. Overridable in Settings. Max **1** review→fix retry. | Independent reviewer; bounded cost. |
| D6 | **P&L = revenue − cost** per project. Revenue entered manually (USD or VND). Cost = LLM + embedding + image + pricing-extraction calls. | User sells project work; needs margin. |
| D7 | Budget exceeded → **warning** by default. Settings toggle **Hard Stop** blocks every paid call once exceeded. | User choice. |
| D8 | Money displayed as **USD on line 1, VND on line 2**. FX rate auto-fetched daily; manual override in Settings. | User requirement. |
| D9 | Price tables **auto-update**: fetch provider pricing pages → LLM extracts into `PriceTable` → validate (schema + bounds + max % change) → apply, else keep last-known-good and warn. Seed table shipped in repo. Ledger rows freeze cost at write time. | Prices change; history must stay correct. |
| D10 | Router fallback is mandatory. Settings toggle **Auto Fallback**: ON → automatic switch down the ladder; OFF → UI modal asks which model to use. Drag-and-drop ladder ordering; optional lock-to-model. | User requirement. |
| D11 | Failure policy everywhere: **snapshot before write → rollback on failure → report with next steps.** Runtime uses a per-transaction file journal; dev loop uses git checkpoints. | Never leave a half-written workspace. |
| D12 | **Image generation** (DALL·E 3, FLUX via Together/Replicate; Midjourney adapter disabled — no official API) and **packaging/installer** are **specified now, implemented later** (M8, M9). Contracts already exist in `schemas.ts` §13. | Scope control without future breaking changes. |
| D13 | Every persisted entity carries `projectId`. Whether the UI supports **one or many concurrent projects** is an **open question** (Q-01); the data model supports both. | Defer decision without lock-in. |
| D14 | Single user, local only, no auth/multi-tenant. Windows first; macOS/Linux not tested in v1. | Scope. |
| D15 | Provider adapters: **Anthropic SDK**, **OpenAI SDK** (also used for xAI, Groq, Together via `baseURL` — OpenAI-compatible), **Google GenAI SDK**. Exact model ids live in `config/models.seed.json`, never hard-coded in logic. | Few adapters; model churn is config, not code. |
| D16 | Runtime write safety: the Worker only writes paths inside the project root **and** inside `TaskSpec.allowedPaths`; runs only allow-listed commands from Settings, never commands proposed by a model. | Prevent model-driven path traversal / RCE. |

## 4. Open questions (ask the user before the milestone that needs them)

| ID | Question | Needed by | Default if unanswered |
|---|---|---|---|
| Q-01 | One active project at a time, or several concurrently, each with its own P&L view? | M4 (UI shell) | One active project + project switcher; P&L per project. |
| Q-02 | Exact default Coder model id (Codex-class) and PM/Reviewer Claude model id. | M2 | Verified from provider `/models` endpoints during M2; written to seed config. |
| Q-03 | FX data source preference (e.g. Vietcombank vs. generic open FX API). | M3 | Generic open FX API, configurable URL. |
| Q-04 | UI theme palettes supplied in `src/image/theme/` (20 four-color palettes, Color Hunt hex codes in filenames; named sets Cold, DarkCold, DarkWinter, Fall, Summer, Winter). How are they used? | M4 | Every palette becomes a selectable theme in Settings → Appearance; named "Dark*" palettes are dark themes; default theme = `ColdColor` (light) / `DarkColdColor` (dark), following OS light/dark. |

## 5. Glossary

| Term | Meaning |
|---|---|
| **Sidecar** | The Node.js process spawned by Tauri. Hosts all services. Also called *the Worker* when doing file/command work. |
| **Ladder** | Ordered list of models (`LadderEntry[]`) the router tries, priority 1 first. |
| **Fallback** | Moving from a failed model to the next eligible ladder model. Triggered only by `FALLBACK_TRIGGERS`. |
| **Circuit breaker** | Per-model state that skips a model after N consecutive failures for a cooldown. |
| **Ledger** | Append-only table of `LedgerEntry` — one row per billed provider call. |
| **µUSD** | Micro-dollars, integer. All money math is integer µUSD. |
| **Pipeline run** | One execution of PM → Coder → Reviewer → Worker for a user prompt (`PipelineRun`). |
| **Transaction** | One atomic multi-file write by the Worker (`WriteTransaction`), journaled for rollback. |
| **Journal** | `.itstudio/tx/<transactionId>/` inside the project: manifest + pre-write copies of touched files. |
| **Companion extension** | The IT Studio VS Code extension (`apps/vscode-ext`). |
| **Task file** | `docs/tasks/<ID>.md` — the prompt Claude hands to Codex for one ROADMAP task. |
| **ADR** | Architecture Decision Record in `docs/decisions/`. |

## 6. System map

```
┌────────────────────────── Tauri App (desktop window) ──────────────────────────┐
│  React UI (apps/desktop/src)                                                   │
│  Tabs: Chat · Code · Knowledge · Gallery(M8) · Cost & P&L · Settings           │
│        │ RpcClient (JSON-RPC 2.0)                         ▲ notifications      │
│        ▼                                                  │                    │
│  Rust shell (apps/desktop/src-tauri): spawn + supervise sidecar, relay lines   │
└────────│──────────────────────────────────────────────────│────────────────────┘
         │ stdin (NDJSON)                                    │ stdout (NDJSON)
┌────────▼──────────────────────────────────────────────────┴────────────────────┐
│  Node Sidecar (apps/sidecar)                                                   │
│  RpcServer → Services:                                                         │
│   ChatService · LlmRouter · ProviderAdapters · SecretStore(keychain)          │
│   LedgerService · PricingService · FxService · BudgetGuard · PnLService       │
│   RagService (parse → chunk → embed → LanceDB) · PipelineOrchestrator          │
│   WorkspaceWorker (journal, atomic write, rollback, CommandRunner)             │
│   VSCodeBridge (WS server, launcher, extension installer)                      │
│  Storage: SQLite (app data dir) · LanceDB (app data dir)                       │
└────────│───────────────────────────────│───────────────────────────────────────┘
         │ HTTPS                          │ ws://127.0.0.1:<port> + token
         ▼                                ▼
  Anthropic · OpenAI · Google ·     VS Code + companion extension
  xAI · Groq · Together ·           (opened on the user's project folder)
  Replicate                                │
                                           ▼
                               User project workspace on disk
```

## 7. Key data flows (summary — details in ARCHITECTURE.md)

1. **Chat:** UI `chat.send` → ChatService builds context (history + optional RAG hits) → `BudgetGuard.check` → `LlmRouter.dispatch` (ladder/fallback) → stream `chat.delta` → on finish `LedgerService.record` → `chat.completed` + `ledger.entry` → P&L tab updates live.
2. **Fallback (Auto ON):** 429/quota/5xx/timeout → retry or next ladder model → `router.event{fallback}` → UI shows "Switched A → B" badge; partial streamed text is discarded and the stream restarts.
3. **Fallback (Auto OFF):** same failure → `router.fallbackRequired` → modal with candidates + estimated cost → `router.resolveFallback`.
4. **RAG ingest:** `rag.ingest(paths)` → parse → hash (skip unchanged) → chunk → embed (batched, metered) → LanceDB upsert → `rag.progress`.
5. **RAG query:** user turn → embed query → LanceDB top-K → filter by `minScore` → inject as cited context → citations rendered in chat.
6. **Pipeline:** `pipeline.start(prompt)` → PM → `TaskSpec` → Coder → `CoderOutput` → Reviewer → `ReviewVerdict` → (≤1 fix loop) → Worker transaction (journal → write) → extension reveals/diffs → validation commands → COMPLETED, or ROLLED_BACK + `FailureReport`.
7. **Pricing:** scheduler (default 24 h) → fetch pages → LLM extraction (metered, purpose `pricing_extraction`) → validate → new `PriceTable` version or reject.

## 8. Repository layout (target)

```
IT Studio/
├─ AGENTS.md            # Codex entry point (read order + hard rules)
├─ CONTEXT.md           # this file
├─ ARCHITECTURE.md      # high-level + component specs
├─ ROLES.md             # agent roles, prompts, I/O contracts
├─ ROADMAP.md           # milestones + checkable tasks
├─ CONVENTIONS.md       # coding standards, security, changelog rules
├─ CHANGELOG.md
├─ docs/
│  ├─ decisions/        # ADR-NNNN-*.md
│  └─ tasks/            # <TaskID>.md — Codex task prompts
├─ config/              # models.seed.json, pricing.seed.json, commands.default.json
├─ src/types/schemas.ts # canonical contracts (imported as @itstudio/schemas)
├─ apps/
│  ├─ desktop/          # Tauri: src/ (React) + src-tauri/ (Rust)
│  ├─ sidecar/          # Node services
│  └─ vscode-ext/       # companion extension
└─ package.json         # npm workspaces root
```

## 9. Environment facts (verified 2026-10-01)

- Windows 11, Node v24.19, npm 11.17, codex-cli 0.159.3, VS Code 1.140 (`code` on PATH), git 2.54.
- Rust stable 1.99 (MSVC) installed via rustup (M0-01); MSVC Build Tools 2022 and WebView2 present.
- Git repo initialised on `main` (M0-02). Codex invocation verified (M0-03, see `AGENTS.md` §5).
- Toolchain pins: ADR-0002 (TypeScript 6.0.x, not 7).

## 10. Where to find what

| Need | Go to |
|---|---|
| A type / contract | `src/types/schemas.ts` |
| How a component works | `ARCHITECTURE.md` |
| What an agent may / may not do | `ROLES.md` |
| What to work on next | `ROADMAP.md` (first unchecked task whose dependencies are checked) |
| How to write code / commit / log changes | `CONVENTIONS.md` |
| Why something was decided | §3 above, then `docs/decisions/` |
