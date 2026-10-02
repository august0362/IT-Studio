# ROADMAP.md — Milestones & Tasks

> **How to use:** work on the first unchecked task whose dependencies are all checked.
> `- [ ]` pending · `- [x]` done (QA-verified) · `- [~]` in progress · `- [!]` blocked (reason inline).
> Only the QA role ticks boxes (ROLES §1.2). Each task's full prompt lives in `docs/tasks/<ID>.md` (created just-in-time by the Architect).
> Owner: **A** = Architect/Claude · **C** = Codex.

## Progress

| Milestone | Status | Tasks |
|---|---|---|
| M0 Environment & scaffold | **Done** | 8 / 8 |
| M1 Sidecar core & IPC | **Done** | 7 / 7 |
| M2 LLM router & providers | In progress | 4 / 10 |
| M3 Cost, pricing, FX, budget, P&L | In progress | 1 / 7 |
| M4 UI shell, Settings, Chat, P&L | Not started | 0 / 7 |
| M5 RAG | Not started | 0 / 7 |
| M6 Agent pipeline & Worker | Not started | 0 / 7 |
| M7 VS Code companion extension | Not started | 0 / 5 |
| M8 Image generation *(deferred)* | Deferred | 0 / 5 |
| M9 Packaging & release *(deferred)* | Deferred | 0 / 6 |
| **v2** M10 Agent Orchestrator | After v1 | 0 / 7 |
| **v2** M11 Agent Memory | After v1 | 0 / 6 |
| **v2** M12 Channels framework + Outbox + VS Code chat | After v1 | 0 / 6 |
| **v2** M13 Gmail channel | After v1 | 0 / 6 |
| **v2** M14 Facebook Page channel | After v1 | 0 / 4 |

---

## M0 — Environment & scaffold

**Exit criteria:** `npm run typecheck && npm run lint && npm test` green on skeleton; `npm run dev` opens the Tauri window showing a placeholder; repo under git.

- [x] **M0-00** (A) Author spec set: CONTEXT, ARCHITECTURE, ROLES, ROADMAP, CONVENTIONS, AGENTS, CHANGELOG, `schemas.ts` (strict-compiles, zero `any`).
- [x] **M0-01** (A) Install Rust toolchain (rustup stable MSVC) + verify WebView2 + MSVC Build Tools. *Needs user consent.* — AC: `cargo --version`, `rustc --version` succeed.
- [x] **M0-02** (A) `git init`; `.gitignore` (node_modules, dist, target, `*.db`, `.itstudio/`, `.env*`), `.gitattributes` (LF), first commit of docs. — AC: clean `git status`.
- [x] **M0-03** (A) Verify `codex exec` flags / sandbox mode / auth on this machine; record exact invocation in `AGENTS.md` §5. — AC: dry-run task edits a scratch file and exits 0.
- [x] **M0-04** (C) npm workspaces root; `tsconfig.base.json` (CONVENTIONS §2); alias `@itstudio/schemas`; skeleton packages `apps/sidecar` (tsx), `apps/desktop` (Tauri v2 + React 19 + Vite + Tailwind), `apps/vscode-ext` (esbuild). Deps: M0-01, M0-02. — AC: each package typechecks importing a type from `@itstudio/schemas`.
- [x] **M0-05** (C) ESLint flat config: typescript-eslint `strict-type-checked`, `no-explicit-any`, `no-restricted-syntax` (TSEnumDeclaration, TSModuleDeclaration, default export), `eslint-plugin-boundaries` per CONVENTIONS §3.2; Prettier; `scripts/scan-secrets.mjs` (regex for common key formats) wired to `npm run lint`. — AC: a fixture file with `enum`/`any`/fake key fails lint.
- [x] **M0-06** (C) Vitest workspace + coverage thresholds (CONVENTIONS §6); root scripts `typecheck`, `lint`, `test`, `dev`. — AC: one sample test per package passes.
- [x] **M0-07** (A) Config seeds: `config/models.seed.json`, `config/pricing.seed.json`, `config/pricing.sources.json`, `config/commands.default.json`, `config/fx.json`. — AC: each validates against its `schemas.ts` type via a test added in M1-01.

## M1 — Sidecar core & IPC

**Exit criteria:** UI ↔ sidecar round-trip for `system.ping` and `settings.get`; killing the sidecar process triggers auto-restart and UI recovers; keys stored/verified via keychain.

- [x] **M1-01** (C) `apps/sidecar/src/validation/`: zod schemas mirroring every `schemas.ts` type used at boundaries + compile-time equality tests (`expectTypeOf<z.infer<…>>().toEqualTypeOf<…>()`); validates `config/*.json`. Ref: ARCH §1.
- [x] **M1-02** (C) Bootstrap: NDJSON stdio loop, `RpcServer` (registry, -32700/-32600/-32601/-32602/-32000 mapping), typed `EventBus`, pino logger (stderr + rotating file, redaction), `container.ts`, `system.ping`, `system.shutdown`, `system.ready`. Ref: ARCH §2–§4.
- [x] **M1-03** (C) Rust shell: spawn sidecar (dev: `node --import tsx`), `sidecar_send` command, `sidecar://message` event, restart backoff + `sidecar://fatal`, graceful shutdown, capability lockdown, CSP. Ref: ARCH §2.3, §3.1, §11.
- [x] **M1-04** (C) UI `RpcClient` typed by `RpcMethodMap`/`RpcNotificationMap`, `useRpcQuery`/`useRpcMutation` (TanStack Query), `useNotification(name, handler)`, timeouts, fail-in-flight on restart.
- [x] **M1-05** (C) SQLite infra (better-sqlite3 + Drizzle, WAL, migrations); repositories for `projects`, `settings`; `SettingsService` with complete defaults; `ProjectService` (`project.*`, `settings.*`). Ref: ARCH §12.
- [x] **M1-06** (C) `ISecretStore` + keychain impl (`@napi-rs/keyring`, service name `itstudio`) + in-memory impl for tests; `secrets.set/delete/status/verify` (verify = cheapest list-models call). Ref: ARCH §11, D2.
- [x] **M1-07** (C) UI status bar: sidecar connection state + version; minimal Settings → API Keys page (write-only inputs, status chips with hint).

## M2 — LLM router & providers

**Exit criteria:** with fixtures, 429 on model A ⇒ answer from model B + `router.event{fallback}`; Auto Fallback OFF ⇒ `router.fallbackRequired` then resumes on `router.resolveFallback`; quota exhaustion opens circuit.

- [x] **M2-01** (C) `ILlmProvider` port, `ProviderRequest/Response`, `ProviderFailure`; shared adapter contract test suite; msw fixture harness. Ref: ARCH §5.1.
- [x] **M2-02** (C) Anthropic adapter: complete, stream, tools, usage incl. cache reads, failure classification table. Ref: ARCH §5.2.
- [x] **M2-03** (C) OpenAI-compatible adapter (OpenAI, xAI, Groq, Together via baseURL config).
- [ ] **M2-04** (C) Google GenAI adapter.
- [ ] **M2-05** (A+C) Model registry from `models.seed.json`, `models.list`; A resolves Q-02 (verify model ids via provider list endpoints) and updates seed + `RoleAssignment` defaults.
- [x] **M2-06** (C) Pure router state machine `domain/router-machine.ts` with explicit transition table; tests for every transition incl. illegal ones. Ref: ARCH §5.3.
- [ ] **M2-07** (C) `LlmRouter` service: eligibility, ordering (override → lock → ladder), retry/backoff+jitter, fallback, circuit breaker, cancel, mid-stream fallback, `router.event`s.
- [ ] **M2-08** (C) Auto Fallback OFF: `FallbackDecisionRequest` with candidate cost estimates, `router.resolveFallback`, expiry → `FALLBACK_DECLINED`.
- [ ] **M2-09** (C) `router.getConfig` / `router.updateConfig` with validation (unique priorities, existing models).
- [ ] **M2-10** (C) `ChatService`: conversations/messages repos, `chat.*` RPC, streaming via router (`chat.delta/completed/failed`), optional RAG context, per-message cost. *(Gap found 2026-10-02: backend for M4-04.)*

## M3 — Cost, pricing, FX, budget, P&L

**Exit criteria:** every billed call creates a ledger row with frozen cost + price version; Hard Stop blocks paid calls; P&L numbers match hand-computed fixtures; prices auto-update with validation.

- [x] **M3-01** (C) `domain/cost.ts`, `domain/money.ts` (integer µUSD, rounding, `MoneyDisplay` USD/VND formatting). ≥ 95 % coverage. Ref: ARCH §6.1, §6.3.
- [ ] **M3-02** (C) Ledger repository (append-only) + `LedgerService.record` subscribed to router completions (incl. `billedFailure`), `ledger.entry` notification, `ledger.query` with cursor paging.
- [ ] **M3-03** (C) Price tables: seed import, versioning, `pricing.get`, `pricing.override` (manual precedence rules).
- [ ] **M3-04** (C) Pricing updater: sources fetch, HTML→text, extraction via router (prompt ROLES §2.5), validation (bounds, max Δ%), apply/reject, scheduler single-flight, `pricing.updated`. Ref: ARCH §6.2.
- [ ] **M3-05** (C) `FxService`: daily fetch, manual override, `fx.get`, `fx.override`; MoneyDisplay uses latest rate.
- [ ] **M3-06** (C) `BudgetGuard` + budgets repo: estimate, levels, once-per-threshold alerts, Hard Stop rejection, `budget.set/status`. Ref: ARCH §6.4.
- [ ] **M3-07** (C) Revenue entries (`revenue.add`, VND→µUSD at entry), `PnLService`, `pnl.get` breakdowns.

## M4 — UI shell, Settings, Chat, P&L

**Exit criteria:** manual script `docs/qa/M4-smoke.md` passes: add key → chat streams → force fallback shows badge/modal → cost appears live in P&L in USD+VND.

- [ ] **M4-00** (A) Resolve Q-01 (single vs multi project) with user; update CONTEXT §3/§4.
- [ ] **M4-01** (C) App shell: tabs (Chat, Code, Knowledge, Gallery-disabled, Cost & P&L, Settings), project switcher, i18n scaffolding (en, vi) via react-i18next.
- [ ] **M4-01b** (C) Theme system per `docs/design/THEMES.md` §5–§7: token CSS variables + Tailwind mapping, no-flash startup, system-mode listener, Settings → Theme picker (cards, filters, hover preview, a11y radiogroup), Monaco theme bridge, contrast test over all 36 theme/mode pairs, ban raw colors in components. (Data `config/themes.json` done by A.)
- [ ] **M4-02** (C) Shared components: `<Money>`, `<SafeMarkdown>` (+ XSS test corpus), `<ErrorPanel>` (renders `AppError.remediation`).
- [ ] **M4-03** (C) Settings: Router ladder (dnd-kit), **Auto Fallback** toggle, lock model, Budget (+ **Hard Stop** toggle), Pricing (table, refresh, override), FX (rate, override), VS Code options, Pipeline role assignment.
- [ ] **M4-04** (C) Chat tab: conversation list, unified model dropdown (+ Lock), streaming with cancel, fallback badge + partial-reset handling, fallback modal (Auto OFF), per-message cost `<Money>`.
- [ ] **M4-05** (C) Cost & P&L tab: revenue/cost/margin KPIs, charts by model/purpose/day (Recharts), budget bars with warning states, revenue entry form (USD/VND), ledger table with filters; live refresh on `ledger.entry`.

## M5 — RAG

**Exit criteria:** ingest `fixtures/docs` (md, pdf, docx, code) → re-ingest skips unchanged → question returns cited answer; embedding cost visible in P&L.

- [ ] **M5-01** (C) Parsers: md, txt, code, pdf (pdfjs-dist), docx (mammoth), html; size/ext guards.
- [ ] **M5-02** (C) Chunker (`domain/chunker.ts`): heading-aware + code-window, token target/overlap, `sectionPath`; property tests.
- [ ] **M5-03** (C) `IEmbeddingProvider` (OpenAI, Google) + dispatcher with same-dimension fallback + ledger metering.
- [ ] **M5-04** (C) LanceDB `IVectorStore` repo (per-project table, upsert, delete by doc, cosine search with filters).
- [ ] **M5-05** (C) `RagService` ingest jobs: discovery, hash skip, progress events, per-file failure isolation, `rag.*` RPC.
- [ ] **M5-06** (C) Retrieval: minScore filter, MMR, context injection, citation parts, `search_knowledge` tool; chat `ragEnabled` toggle.
- [ ] **M5-07** (C) Knowledge tab: add files/folder, document list (format, chunks, model, date), re-index, delete, test-query panel.

## M6 — Agent pipeline & Worker

**Exit criteria:** on `fixtures/sample-project`, a prompt reaches COMPLETED with files written and tests green; a forced failing validation produces ROLLED_BACK with byte-identical restore and a `FailureReport`; crash mid-commit recovers on restart.

- [ ] **M6-01** (C) `resolveSafe` + `IFileSystem`; traversal test suite (`..`, absolute, UNC, drive, symlink escape, NUL, `.git`). Ref: ARCH §9.1.
- [ ] **M6-02** (C) `WriteTransaction` Unit of Work: journal, baseHash check, patch apply, tmp+rename commit, rollback, crash recovery at startup. Ref: ARCH §9.2–§9.4.
- [ ] **M6-03** (C) `CommandRunner` (`shell:false`, env scrub, timeout, tail) + parsers (tsc, eslint json, vitest json). Ref: ARCH §9.5.
- [ ] **M6-04** (C) Role prompts (ROLES §2.1–2.3 verbatim), JSON schema generation from zod, output validation + single re-ask.
- [ ] **M6-05** (C) `PipelineOrchestrator`: stage machine, role ladders, verdict rule, ≤ 1 fix round, per-project queue, cancel semantics, `pipeline.*` RPC + events. Ref: ARCH §8.1.
- [ ] **M6-06** (C) `FailureReportBuilder` + remediation table for every `ErrorCode`.
- [ ] **M6-07** (C) Code tab: prompt box, stage timeline, spec/review viewers, Monaco diff viewer, live command output, failure report panel, run history.

## M7 — VS Code companion extension

**Exit criteria:** starting a pipeline auto-opens VS Code on the project, changed files are revealed with diff, diagnostics appear in the app; closing VS Code mid-run does not fail the run.

- [ ] **M7-01** (C) Extension skeleton: activation on `workspaceContains:.itstudio/session.json`, WS client, `ExtHello`, reconnect, status bar item.
- [ ] **M7-02** (C) Sidecar `VSCodeBridge`: WS server on loopback, token (constant-time), Origin rejection, heartbeat, `vscode.status`. Ref: ARCH §10.1.
- [ ] **M7-03** (C) Launcher (`code` resolve, `shell:false`) + installer (`--list-extensions`, `--install-extension` bundled vsix) + vsix build script; `.itstudio/` gitignore guard.
- [ ] **M7-04** (C) `reveal`, `show_diff`, `transaction` decorations, `notify`.
- [ ] **M7-05** (C) Diagnostics streaming (debounced) + `file_saved_by_user` → stale-run conflict marking.

## M8 — Image generation *(deferred — do not start without user go-ahead)*

Spec: ARCH §14.1, `schemas.ts` §13.

- [ ] **M8-01** (C) `IImageProvider` port + DALL·E 3 adapter.
- [ ] **M8-02** (C) FLUX adapters (Together sync, Replicate polling); Midjourney adapter compiled but disabled.
- [ ] **M8-03** (C) `generate_image` tool dispatch: validation, BudgetGuard, provider fallback, download-and-store, ledger (`purpose=image`).
- [ ] **M8-04** (C) Chat inline image rendering via asset protocol.
- [ ] **M8-05** (C) Gallery tab.

## M9 — Packaging & release *(deferred)*

Spec: ARCH §14.2.

- [ ] **M9-01** (C) esbuild sidecar bundle + Node SEA build script; native module loading from resources.
- [ ] **M9-02** (C) Tauri `externalBin` + resources (vsix, seeds); production sidecar spawn path.
- [ ] **M9-03** (C) NSIS + MSI bundles; WebView2 bootstrapper.
- [ ] **M9-04** (A) Code-signing setup (user supplies certificate) + updater key pair (private key outside repo).
- [ ] **M9-05** (C) Version bump script (4 manifests) + release CHANGELOG automation.
- [ ] **M9-06** (A) Clean-VM smoke test checklist and execution.

---

# v2 — Multi-Agent & Omnichannel Hub (start only after M7; ADR-0003, ARCH Part II)

## M10 — Agent Orchestrator

**Exit criteria:** user creates a custom agent in the Agent Builder and chats with it; the v1 pipeline runs as an agent team with unchanged behaviour; agent costs appear in P&L.

- [ ] **M10-01** (A+C) `agents` table + repo; A writes `config/agents.seed.json` (6 templates); seeded on first run; `agents.*` RPC; additive CostPurpose `agent`, `memory_extraction`, `triage` (ADR).
- [ ] **M10-02** (C) `AgentRunner`: context building, tool loop (≤ 6 calls), trigger-based tool restrictions (ARCH §15.2), `AgentRun` persistence.
- [ ] **M10-03** (C) Routing rules repo + matcher + `routing.*` RPC.
- [ ] **M10-04** (C) Tools `search_knowledge`, `draft_reply` (Outbox stub until M12-02), `start_pipeline`.
- [ ] **M10-05** (C) Re-express the §8 pipeline as a PM/Coder/QA agent team (no behaviour change; M6 regression tests).
- [ ] **M10-06** (C) Settings → Agents: Agent Builder UI (list, clone template, edit persona/ladder/tools/channels/memory policy).
- [ ] **M10-07** (C) Chat tab agent picker + per-project default agent.

## M11 — Agent Memory

**Exit criteria:** after a conversation the agent recalls a stated preference in a new conversation; the user can view/edit/pin/delete it; nothing is extracted from external channels by default.

- [ ] **M11-01** (C) `memories` table + LanceDB `memories_<agentId>` store (upsert, delete, search).
- [ ] **M11-02** (C) Extraction service (prompt ROLES §2.8), dedupe (cos ≥ 0.92), secret/PII filter; runs when a user-driven conversation closes.
- [ ] **M11-03** (C) Recall scoring (ARCH §16.3), memory context injection, `recall_memory` tool.
- [ ] **M11-04** (C) Explicit remember: "remember …" phrase, message action, `remember` tool (non-external triggers only).
- [ ] **M11-05** (C) `memory.*` RPC (list/search/update/pin/delete/forgetAll/export/cleanup).
- [ ] **M11-06** (C) Memory page UI.

## M12 — Channels framework, Outbox, VS Code chat

**Exit criteria:** a fake adapter syncs on click, an agent drafts a reply into the Outbox, nothing is sent until approved; the VS Code chat panel talks to agents.

- [ ] **M12-01** (C) `IChannelAdapter` port, `ChannelService` (user-triggered sync), `channel_accounts` / `channel_messages` tables, `channels.*` RPC, fake adapter + contract tests.
- [ ] **M12-02** (C) `OutboxService`: approval lifecycle, edit, send-only-on-approve, 20/h/account cap, expiry; `outbox.*` RPC.
- [ ] **M12-03** (C) Triage service (batch, cheapest JSON model, purpose `triage`) + "Process" → routing → AgentRunner.
- [ ] **M12-04** (C) Inbox tab UI (Inbound / Outbox panes, badges, approve/edit/reject).
- [ ] **M12-05** (C) VS Code protocol v2 + webview chat panel (agent picker, send selection/file).
- [ ] **M12-06** (C) Sidecar side of VS Code chat (route to AgentRunner, stream replies).

## M13 — Gmail channel

**Exit criteria:** on click, new mail is fetched; Triage labels it; an agent drafts a reply; approve sends it in-thread; an `[ITS]` email from the user's own address becomes a confirmed command.

- [ ] **M13-01** (C) OAuth installed-app flow (PKCE, loopback) + refresh token in keychain; connect/disconnect.
- [ ] **M13-02** (C) Sync via `history.list` (fallback `messages.list`), MIME → plain text, attachment names only.
- [ ] **M13-03** (C) Send with threading headers; Outbox integration.
- [ ] **M13-04** (C) Apply `ITStudio/*` labels after triage confirmation.
- [ ] **M13-05** (C) Email commands (allow-list, `[ITS]` prefix, DKIM pass, in-app confirmation).
- [ ] **M13-06** (A+C) "Email me this report" actions + A writes `docs/guides/gmail-setup.md`.

## M14 — Facebook Page channel

**Exit criteria:** on click, new Page conversations are fetched; an agent drafts; approve sends within the 24 h window; expired drafts are blocked with guidance.

- [ ] **M14-01** (C) Page token connect (keychain), page info + permission check.
- [ ] **M14-02** (C) Conversations sync (user-triggered).
- [ ] **M14-03** (C) Send API with 24 h window enforcement + rate-limit backoff.
- [ ] **M14-04** (A) `docs/guides/facebook-page-setup.md` (Meta app, permissions, long-lived Page token).

---

## Doc Debt

*(Contradictions or gaps found in docs; Architect resolves before the next task.)*

- none
