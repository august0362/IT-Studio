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
| D9 | Price tables update **only when the user clicks "Update prices"** (Q-05, 2026-10-02): fetch provider pricing pages → LLM extracts into `PriceTable` → validate (schema + bounds + max % change) → apply, else keep last-known-good and warn. The app reminds the user when the table is older than 30 days. Seed table shipped in repo. Ledger rows freeze cost at write time. | Prices change; history must stay correct; no token spend without user action. |
| D10 | Router fallback is mandatory. Settings toggle **Auto Fallback**: ON → automatic switch down the ladder; OFF → UI modal asks which model to use. Drag-and-drop ladder ordering; optional lock-to-model. | User requirement. |
| D11 | Failure policy everywhere: **snapshot before write → rollback on failure → report with next steps.** Runtime uses a per-transaction file journal; dev loop uses git checkpoints. | Never leave a half-written workspace. |
| D12 | **Image generation** (DALL·E 3, FLUX via Together/Replicate; Midjourney adapter disabled — no official API) and **packaging/installer** are **specified now, implemented later** (M8, M9). Contracts already exist in `schemas.ts` §13. | Scope control without future breaking changes. |
| D13 | **Multiple projects (Q-01, 2026-10-02):** several projects can be open at once (project tabs) and run pipelines in parallel (one run per project at a time); the user can switch freely; every project has its own P&L **and** an aggregate P&L dashboard covers all projects. Every persisted entity carries `projectId`. | User decision |
| D14 | Single user, local only, no auth/multi-tenant. Windows first; macOS/Linux not tested in v1. | Scope. |
| D15 | Provider adapters: **Anthropic SDK**, **OpenAI SDK** (also used for xAI, Groq, Together via `baseURL` — OpenAI-compatible), **Google GenAI SDK**. Exact model ids live in `config/models.seed.json`, never hard-coded in logic. | Few adapters; model churn is config, not code. |
| D16 | Runtime write safety: the Worker only writes paths inside the project root **and** inside `TaskSpec.allowedPaths`; runs only allow-listed commands from Settings, never commands proposed by a model. | Prevent model-driven path traversal / RCE. |
| D17 | **Themes:** Settings → Theme offers 18 themes derived from the palettes in `src/image/theme/`, each with light + dark variants and a follow-system mode, designed with color psychology (mood, rationale, recommended activities per theme) and WCAG AA/AAA contrast enforced by tooling. Defaults: Arctic Focus (light) / Midnight Focus (dark). Spec: `docs/design/THEMES.md`. | User requirement (2026-10-02). |
| D18 | **v2 Agent Orchestrator** (after v1, M10): built-in agent templates (PM, Architect, Coder, QA, Email Assistant, Page Support) + user-created agents (Agent Builder); each agent = persona + model ladder + tools + channels + memory policy; rule-based routing + user choice (no supervisor agent). The v1 pipeline becomes an agent team. | User decision 2026-10-02, ADR-0003 |
| D19 | **Agent Memory** (M11): auto-extracted facts/preferences/instructions per agent + project (optional global), LanceDB vectors + SQLite metadata, dedupe, importance + recency scoring; user can view/edit/pin/delete/forget; extraction from external channels off by default. | ADR-0003 |
| D20 | **Channels** (M12–M14) via `IChannelAdapter`: app, VS Code chat panel, Gmail (triage, draft replies, email commands, email reports), Facebook **Page** Messenger only (no personal accounts). | ADR-0003 |
| D21 | **On-demand only:** no background polling, schedulers or agent runs for channels; every sync/agent run starts from a user action. Fetching from channel APIs costs no LLM tokens; triage/drafting runs only when the user clicks. | User: "only when I act — tokens cost money" |
| D22 | **Outbox approval:** every outbound message to an external channel is a draft until the user approves it; no auto-send; external-triggered runs get a restricted tool set. | Prompt-injection & wrong-send safety |
| D23 | **Email commands:** accepted only from allow-listed senders (default: own address), subject prefix `[ITS]`, DKIM pass; side-effecting actions need in-app confirmation. | Anti-spoofing |
| D24 | **v3 Infrastructure (after v2, M15–M19):** agentless management of servers (Dell home-lab via Tailscale, VPS, any SSH host) — one `ssh2` connection per server shared by metrics, Docker, SFTP and system actions. | User 2026-10-02, ADR-0004 |
| D25 | **Monitoring mode is a Settings toggle:** off (default) → poll only while the Servers tab is visible; on → background polling every 3–60 s (default 5) with alert rules (offline, CPU, RAM, disk, battery, container exited) delivered as in-app toast + optional OS notification. Metrics use no LLM tokens. | User decision |
| D26 | **SSH key vault:** private key encrypted (AES-256-GCM) in app data, data key + passphrase in OS keychain; host keys pinned on first use (TOFU) with hard fail on mismatch. | Credential Manager 2.5 KB limit; MITM safety |
| D27 | **Remote file edits:** diff shown before save, automatic `.itstudio-bak-<ts>` backup, conflict check by SHA-256, atomic tmp+rename, undo. | User decision |
| D28 | **Docker via `docker system dial-stdio` over SSH** (dockerode); no socket forwarding or open ports; log streaming via sidecar notifications. | Cross-OS, simpler than forwarding |
| D29 | **Target OS:** Linux, macOS and Windows Server — per-OS command/collector strategies; commands only from a fixed catalog. | User decision |
| D30 | **AI agents operating servers: deferred** (documented in ARCH §23; requires a new ADR before implementation). | User decision |
| D31 | **App-overhead LLM costs** (pricing extraction) are attributed to the **active project**; `pricing.refresh` without an active project fails `VALIDATION` ("Open or create a project first"). No separate system project. | Architect decision (M3-04) |

## 4. Open questions (ask the user before the milestone that needs them)

| ID | Question | Needed by | Default if unanswered |
|---|---|---|---|
| Q-02 | Exact default Coder model id (Codex-class) and PM/Reviewer Claude model id. | M2 | Verified from provider `/models` endpoints during M2; written to seed config. |

**Resolved 2026-10-02:** Q-01 → D13 (multi-project + aggregate P&L) · Q-03 → generic open FX API (`open.er-api.com`, no key, daily fetch — no LLM tokens) · Q-05 → D9 (manual price updates) · Sandbox/worktree workflow kept (AGENTS.md §5).

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
| **Agent** (v2) | A configured AI worker: persona + model ladder + tools + channels + memory policy (`AgentDefinition`). |
| **Agent Memory** | Long-term per-agent memories (`MemoryItem`) recalled by vector similarity. |
| **Channel** | A place messages come from / go to: app, vscode, gmail, facebook_page (`IChannelAdapter`). |
| **Server** (v3) | A managed SSH host (`ServerConfig`): Linux, macOS or Windows; no agent installed. |
| **Background monitoring** | Opt-in setting: poll server metrics continuously and raise alerts (D25). |
| **Outbox** | Approval queue of drafted outbound messages; nothing external is sent without approval. |

> **v2 (after v1):** the sidecar also hosts the Agent Orchestrator, Agent Memory and Channel Adapters — see ARCHITECTURE Part II (§15–§17).
> **v3 (after v2):** agentless server management (SSH metrics, Docker, SFTP, system actions) — see ARCHITECTURE Part III (§18–§24).

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
| Theme / colors / UI tokens | `docs/design/THEMES.md`, `config/themes.json` |
| What an agent may / may not do | `ROLES.md` |
| What to work on next | `ROADMAP.md` (first unchecked task whose dependencies are checked) |
| How to write code / commit / log changes | `CONVENTIONS.md` |
| How we test, QA gates, test cases & reports | `TESTING.md`, `docs/qa/` |
| Why something was decided | §3 above, then `docs/decisions/` |
