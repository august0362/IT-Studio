# ROADMAP.md — Milestones & Tasks

> **How to use:** work on the first unchecked task whose dependencies are all checked.
> `- [ ]` pending · `- [x]` done (QA-verified) · `- [~]` in progress · `- [!]` blocked (reason inline).
> Only the QA role ticks boxes (ROLES §1.2). Each task's full prompt lives in `docs/tasks/<ID>.md` (created just-in-time by the Architect).
> Owner: **A** = Architect/Claude · **C** = Codex.
> **Every milestone ends with an `Mx-QA` gate** (TESTING.md §7): a milestone is Done only after its QA report is signed off.

## Progress

| Milestone | Status | Tasks |
|---|---|---|
| M0 Environment & scaffold | **Done** | 8 / 8 |
| M1 Sidecar core & IPC | **Done** (QA signed off) | 8 / 8 |
| M2 LLM router & providers | **Done** (QA signed off) | 11 / 11 |
| M3 Cost, pricing, FX, budget, P&L | In progress | 4 / 8 |
| M4 UI shell, Settings, Chat, P&L | In progress | 3 / 8 |
| M5 RAG | In progress | 4 / 8 |
| M6 Agent pipeline & Worker | In progress | 5 / 8 |
| M7 VS Code companion extension | In progress | 2 / 6 |
| M8 Image generation *(deferred)* | Deferred | 0 / 6 |
| M9 Packaging & release *(deferred)* | Deferred | 0 / 7 |
| **v2** M10 Agent Orchestrator | After v1 | 0 / 8 |
| **v2** M11 Agent Memory | After v1 | 0 / 7 |
| **v2** M12 Channels framework + Outbox + VS Code chat | After v1 | 0 / 7 |
| **v2** M13 Gmail channel | After v1 | 0 / 7 |
| **v2** M14 Facebook Page channel | After v1 | 0 / 5 |
| **v3** M15 SSH foundation & server registry | After v2 | 0 / 6 |
| **v3** M16 Metrics, monitoring & alerts | After v2 | 0 / 8 |
| **v3** M17 Docker management | After v2 | 0 / 6 |
| **v3** M18 Remote file manager | After v2 | 0 / 6 |
| **v3** M19 System actions | After v2 | 0 / 4 |

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
- [x] **M1-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M1-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M1-report.md` sign-off. Scope: Build the L3 sidecar integration harness (spawn sidecar, NDJSON client, temp data dir, `ITSTUDIO_E2E=1` fakes) and the L4 E2E harness (WebdriverIO + tauri-driver + Edge WebDriver); scripts `test:integration`, `test:e2e`, `test:all`. Cases: app launch → sidecar ready, status bar, API Keys save/verify/delete, sidecar crash → auto-restart, settings persistence across restart.
  - Gate sub-tasks (defects found by QA, see docs/qa/M1-report.md): [x] M1-QA integration harness (20/20 ×3) · [x] M1-FIX1 flaky test (BUG-001) · [x] M1-FIX2 lifecycle logs (BUG-003) · [x] BUG-004 S1 RpcClient params (fixed in M1-QA) · [x] M1-QA2 typed tests + runnable E2E (5/8) · [x] M1-FIX3 accessible confirm dialog (BUG-005) · [x] M1-QA3 E2E test defects TC-006/007 · [x] sign-off report (E2E 8/8)

## M2 — LLM router & providers

**Exit criteria:** with fixtures, 429 on model A ⇒ answer from model B + `router.event{fallback}`; Auto Fallback OFF ⇒ `router.fallbackRequired` then resumes on `router.resolveFallback`; quota exhaustion opens circuit.

- [x] **M2-01** (C) `ILlmProvider` port, `ProviderRequest/Response`, `ProviderFailure`; shared adapter contract test suite; msw fixture harness. Ref: ARCH §5.1.
- [x] **M2-02** (C) Anthropic adapter: complete, stream, tools, usage incl. cache reads, failure classification table. Ref: ARCH §5.2.
- [x] **M2-03** (C) OpenAI-compatible adapter (OpenAI, xAI, Groq, Together via baseURL config).
- [x] **M2-04** (C) Google GenAI adapter.
- [x] **M2-05** (A+C) Model registry from `models.seed.json`, `models.list`; A resolves Q-02 (verify model ids via provider list endpoints) and updates seed + `RoleAssignment` defaults.
- [x] **M2-06** (C) Pure router state machine `domain/router-machine.ts` with explicit transition table; tests for every transition incl. illegal ones. Ref: ARCH §5.3.
- [x] **M2-07** (C) `LlmRouter` service: eligibility, ordering (override → lock → ladder), retry/backoff+jitter, fallback, circuit breaker, cancel, mid-stream fallback, `router.event`s.
- [x] **M2-08** (C) Auto Fallback OFF: `FallbackDecisionRequest` with candidate cost estimates, `router.resolveFallback`, expiry → `FALLBACK_DECLINED`.
- [x] **M2-09** (C) `router.getConfig` / `router.updateConfig` with validation (unique priorities, existing models).
- [x] **M2-10** (C) `ChatService`: conversations/messages repos, `chat.*` RPC, streaming via router (`chat.delta/completed/failed`), optional RAG context, per-message cost. *(Gap found 2026-10-02: backend for M4-04.)*
- [x] **M2-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M2-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M2-report.md` sign-off. Scope: Router & providers: fallback decision table, Auto Fallback OFF modal flow, circuit breaker, lock/ladder order, chat streaming via `chat.*` with fake providers; contract suite rerun for all adapters.

## M3 — Cost, pricing, FX, budget, P&L

**Exit criteria:** every billed call creates a ledger row with frozen cost + price version; Hard Stop blocks paid calls; P&L numbers match hand-computed fixtures; prices auto-update with validation.

- [x] **M3-01** (C) `domain/cost.ts`, `domain/money.ts` (integer µUSD, rounding, `MoneyDisplay` USD/VND formatting). ≥ 95 % coverage. Ref: ARCH §6.1, §6.3.
- [x] **M3-02** (C) Ledger repository (append-only) + `LedgerService.record` subscribed to router completions (incl. `billedFailure`), `ledger.entry` notification, `ledger.query` with cursor paging.
- [x] **M3-03** (C) Price tables: seed import, versioning, `pricing.get`, `pricing.override` (manual precedence rules).
- [ ] **M3-04** (C) Pricing updater (**manual only**, D9): `pricing.refresh` fetches sources, HTML→text, extraction via router (prompt ROLES §2.5), validation (bounds, max Δ%), apply/reject, `pricing.updated`; stale-table (> 30 days) reminder flag; set default `pricing.autoUpdate=false` in `domain/default-settings.ts`.
- [x] **M3-05** (C) `FxService`: daily fetch from `open.er-api.com` (no LLM), manual override, `fx.get`, `fx.override`; MoneyDisplay uses latest rate.
- [ ] **M3-06** (C) `BudgetGuard` + budgets repo: estimate, levels, once-per-threshold alerts, Hard Stop rejection, `budget.set/status`. Ref: ARCH §6.4.
- [ ] **M3-07** (C) Revenue entries (`revenue.add`, VND→µUSD at entry), `PnLService`, `pnl.get` breakdowns, **`pnl.getAll` aggregate across projects** (add RPC method + validator, D13).
- [ ] **M3-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M3-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M3-report.md` sign-off. Scope: Ledger/P&L: cost frozen per price version, budget BVA (thresholds) × Hard Stop decision table, manual price update with validation reject, FX override, revenue in VND, per-project and aggregate P&L numbers vs hand-computed oracle.

## M4 — UI shell, Settings, Chat, P&L

**Exit criteria:** manual script `docs/qa/M4-smoke.md` passes: add key → chat streams → force fallback shows badge/modal → cost appears live in P&L in USD+VND.

- [x] **M4-00** (A) Resolve Q-01 — decided 2026-10-02: multiple open projects (tabs) + switcher, per-project P&L and aggregate P&L (D13).
- [ ] **M4-01** (C) App shell: tabs (Chat, Code, Knowledge, Gallery-disabled, Cost & P&L, Settings), **project tabs** (open several projects, switch, close) + "All projects" entry, i18n scaffolding (en, vi) via react-i18next.
- [x] **M4-01b** (C) Theme system per `docs/design/THEMES.md` §5–§7: token CSS variables + Tailwind mapping, no-flash startup, system-mode listener, Settings → Theme picker (cards, filters, hover preview, a11y radiogroup), Monaco theme bridge, contrast test over all 36 theme/mode pairs, ban raw colors in components. (Data `config/themes.json` done by A.)
- [x] **M4-02** (C) Shared components: `<Money>`, `<SafeMarkdown>` (+ XSS test corpus), `<ErrorPanel>` (renders `AppError.remediation`).
- [ ] **M4-03** (C) Settings: Router ladder (dnd-kit), **Auto Fallback** toggle, lock model, Budget (+ **Hard Stop** toggle), Pricing (table, refresh, override), FX (rate, override), VS Code options, Pipeline role assignment.
- [ ] **M4-04** (C) Chat tab: conversation list, unified model dropdown (+ Lock), streaming with cancel, fallback badge + partial-reset handling, fallback modal (Auto OFF), per-message cost `<Money>`.
- [ ] **M4-05** (C) Cost & P&L tab: revenue/cost/margin KPIs, charts by model/purpose/day (Recharts), budget bars with warning states, revenue entry form (USD/VND), ledger table with filters; live refresh on `ledger.entry`. Plus **All-projects dashboard**: per-project margin table, portfolio totals, top spend by project/model.
- [ ] **M4-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M4-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M4-report.md` sign-off. Scope: UI system tests: project tabs open/switch/close, theme switching (all 36 theme/mode pairs smoke + contrast), Settings flows, chat with fallback badge & modal, P&L dashboards; XSS corpus through chat rendering; keyboard-only navigation.

## M5 — RAG

**Exit criteria:** ingest `fixtures/docs` (md, pdf, docx, code) → re-ingest skips unchanged → question returns cited answer; embedding cost visible in P&L.

- [x] **M5-01** (C) Parsers: md, txt, code, pdf (pdfjs-dist), docx (mammoth), html; size/ext guards.
- [x] **M5-02** (C) Chunker (`domain/chunker.ts`): heading-aware + code-window, token target/overlap, `sectionPath`; property tests.
- [x] **M5-03** (C) `IEmbeddingProvider` (OpenAI, Google) + dispatcher with same-dimension fallback + ledger metering.
- [x] **M5-04** (C) LanceDB `IVectorStore` repo (per-project table, upsert, delete by doc, cosine search with filters).
- [ ] **M5-05** (C) `RagService` ingest jobs: discovery, hash skip, progress events, per-file failure isolation, `rag.*` RPC.
- [ ] **M5-06** (C) Retrieval: minScore filter, MMR, context injection, citation parts, `search_knowledge` tool; chat `ragEnabled` toggle.
- [ ] **M5-07** (C) Knowledge tab: add files/folder, document list (format, chunks, model, date), re-index, delete, test-query panel.
- [ ] **M5-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M5-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M5-report.md` sign-off. Scope: RAG: ingest md/pdf/docx/code, unchanged-file skip, per-file failure isolation, cited answers, embedding cost in P&L, re-index on model change.

## M6 — Agent pipeline & Worker

**Exit criteria:** on `fixtures/sample-project`, a prompt reaches COMPLETED with files written and tests green; a forced failing validation produces ROLLED_BACK with byte-identical restore and a `FailureReport`; crash mid-commit recovers on restart.

- [x] **M6-01** (C) `resolveSafe` + `IFileSystem`; traversal test suite (`..`, absolute, UNC, drive, symlink escape, NUL, `.git`). Ref: ARCH §9.1.
- [x] **M6-02** (C) `WriteTransaction` Unit of Work: journal, baseHash check, patch apply, tmp+rename commit, rollback, crash recovery at startup. Ref: ARCH §9.2–§9.4.
- [x] **M6-03** (C) `CommandRunner` (`shell:false`, env scrub, timeout, tail) + parsers (tsc, eslint json, vitest json). Ref: ARCH §9.5.
- [x] **M6-04** (C) Role prompts (ROLES §2.1–2.3 verbatim), JSON schema generation from zod, output validation + single re-ask.
- [ ] **M6-05** (C) `PipelineOrchestrator`: stage machine, role ladders, verdict rule, ≤ 1 fix round, per-project queue, cancel semantics, `pipeline.*` RPC + events. Ref: ARCH §8.1.
- [x] **M6-06** (C) `FailureReportBuilder` + remediation table for every `ErrorCode`.
- [ ] **M6-07** (C) Code tab: prompt box, stage timeline, spec/review viewers, Monaco diff viewer, live command output, failure report panel, run history.
- [ ] **M6-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M6-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M6-report.md` sign-off. Scope: Pipeline: happy path to COMPLETED, review-reject → fix → approve, failing validation → byte-identical rollback, crash mid-commit recovery, path-traversal corpus, cancel at every stage; StrykerJS on worker/domain (score reported). **Carry-over:** case-insensitive `</context>` neutralisation (from M6-04 QA); chunker branch coverage ≥ 90 % (from M5-02 QA) belongs to M5-QA.

## M7 — VS Code companion extension

**Exit criteria:** starting a pipeline auto-opens VS Code on the project, changed files are revealed with diff, diagnostics appear in the app; closing VS Code mid-run does not fail the run.

- [x] **M7-01** (C) Extension skeleton: activation on `workspaceContains:.itstudio/session.json`, WS client, `ExtHello`, reconnect, status bar item.
- [x] **M7-02** (C) Sidecar `VSCodeBridge`: WS server on loopback, token (constant-time), Origin rejection, heartbeat, `vscode.status`. Ref: ARCH §10.1.
- [ ] **M7-03** (C) Launcher (`code` resolve, `shell:false`) + installer (`--list-extensions`, `--install-extension` bundled vsix) + vsix build script; `.itstudio/` gitignore guard.
- [ ] **M7-04** (C) `reveal`, `show_diff`, `transaction` decorations, `notify`.
- [ ] **M7-05** (C) Diagnostics streaming (debounced) + `file_saved_by_user` → stale-run conflict marking.
- [ ] **M7-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M7-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M7-report.md` sign-off. Scope: VS Code (`@vscode/test-electron`): auto-launch, handshake, reveal/diff on commit, diagnostics forwarded, VS Code closed mid-run does not fail the pipeline, bad token rejected.

## M8 — Image generation *(deferred — do not start without user go-ahead)*

Spec: ARCH §14.1, `schemas.ts` §13.

- [ ] **M8-01** (C) `IImageProvider` port + DALL·E 3 adapter.
- [ ] **M8-02** (C) FLUX adapters (Together sync, Replicate polling); Midjourney adapter compiled but disabled.
- [ ] **M8-03** (C) `generate_image` tool dispatch: validation, BudgetGuard, provider fallback, download-and-store, ledger (`purpose=image`).
- [ ] **M8-04** (C) Chat inline image rendering via asset protocol.
- [ ] **M8-05** (C) Gallery tab.
- [ ] **M8-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M8-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M8-report.md` sign-off. Scope: Image generation: tool call → image stored locally, provider fallback, cost per image, gallery.

## M9 — Packaging & release *(deferred)*

Spec: ARCH §14.2.

- [ ] **SEC-01** (A+C) Dependency audit hardening before release: production audit (2026-10-02) = 3 high, all from @lancedb/lancedb → @huggingface/transformers → sharp (libvips CVE-2026-33327/33328/35590/35591). Options: npm `overrides` to a patched sharp, or exclude the optional transformers dependency; add `npm audit --omit=dev --audit-level=high` to the release checklist.
- [ ] **M9-01** (C) esbuild sidecar bundle + Node SEA build script; native module loading from resources.
- [ ] **M9-02** (C) Tauri `externalBin` + resources (vsix, seeds); production sidecar spawn path.
- [ ] **M9-03** (C) NSIS + MSI bundles; WebView2 bootstrapper.
- [ ] **M9-04** (A) Code-signing setup (user supplies certificate) + updater key pair (private key outside repo).
- [ ] **M9-05** (C) Version bump script (4 manifests) + release CHANGELOG automation.
- [ ] **M9-06** (A) Clean-VM smoke test checklist and execution.
- [ ] **M9-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M9-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M9-report.md` sign-off. Scope: Packaging: install on clean VM, first run, sidecar SEA starts, native modules load, update flow.

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
- [ ] **M10-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M10-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M10-report.md` sign-off. Scope: Agents: create/clone/edit agent, team pipeline regression (M6 suite), external-trigger tool restrictions (decision table), agent cost in P&L.

## M11 — Agent Memory

**Exit criteria:** after a conversation the agent recalls a stated preference in a new conversation; the user can view/edit/pin/delete it; nothing is extracted from external channels by default.

- [ ] **M11-01** (C) `memories` table + LanceDB `memories_<agentId>` store (upsert, delete, search).
- [ ] **M11-02** (C) Extraction service (prompt ROLES §2.8), dedupe (cos ≥ 0.92), secret/PII filter; runs when a user-driven conversation closes.
- [ ] **M11-03** (C) Recall scoring (ARCH §16.3), memory context injection, `recall_memory` tool.
- [ ] **M11-04** (C) Explicit remember: "remember …" phrase, message action, `remember` tool (non-external triggers only).
- [ ] **M11-05** (C) `memory.*` RPC (list/search/update/pin/delete/forgetAll/export/cleanup).
- [ ] **M11-06** (C) Memory page UI.
- [ ] **M11-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M11-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M11-report.md` sign-off. Scope: Memory: extraction, dedupe, recall ranking, pin/delete/forget, external extraction off by default, secret/PII filter negatives.

## M12 — Channels framework, Outbox, VS Code chat

**Exit criteria:** a fake adapter syncs on click, an agent drafts a reply into the Outbox, nothing is sent until approved; the VS Code chat panel talks to agents.

- [ ] **M12-01** (C) `IChannelAdapter` port, `ChannelService` (user-triggered sync), `channel_accounts` / `channel_messages` tables, `channels.*` RPC, fake adapter + contract tests.
- [ ] **M12-02** (C) `OutboxService`: approval lifecycle, edit, send-only-on-approve, 20/h/account cap, expiry; `outbox.*` RPC.
- [ ] **M12-03** (C) Triage service (batch, cheapest JSON model, purpose `triage`) + "Process" → routing → AgentRunner.
- [ ] **M12-04** (C) Inbox tab UI (Inbound / Outbox panes, badges, approve/edit/reject).
- [ ] **M12-05** (C) VS Code protocol v2 + webview chat panel (agent picker, send selection/file).
- [ ] **M12-06** (C) Sidecar side of VS Code chat (route to AgentRunner, stream replies).
- [ ] **M12-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M12-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M12-report.md` sign-off. Scope: Channels/Outbox: sync only on click (no background traffic), approval lifecycle state transitions, 20/h cap BVA, VS Code chat panel round trip, prompt-injection corpus.

## M13 — Gmail channel

**Exit criteria:** on click, new mail is fetched; Triage labels it; an agent drafts a reply; approve sends it in-thread; an `[ITS]` email from the user's own address becomes a confirmed command.

- [ ] **M13-01** (C) OAuth installed-app flow (PKCE, loopback) + refresh token in keychain; connect/disconnect.
- [ ] **M13-02** (C) Sync via `history.list` (fallback `messages.list`), MIME → plain text, attachment names only.
- [ ] **M13-03** (C) Send with threading headers; Outbox integration.
- [ ] **M13-04** (C) Apply `ITStudio/*` labels after triage confirmation.
- [ ] **M13-05** (C) Email commands (allow-list, `[ITS]` prefix, DKIM pass, in-app confirmation).
- [ ] **M13-06** (A+C) "Email me this report" actions + A writes `docs/guides/gmail-setup.md`.
- [ ] **M13-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M13-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M13-report.md` sign-off. Scope: Gmail (fake Gmail API + optional live run): OAuth flow, history sync, threading on send, labels, email-command decision table (sender × prefix × DKIM), report emails.

## M14 — Facebook Page channel

**Exit criteria:** on click, new Page conversations are fetched; an agent drafts; approve sends within the 24 h window; expired drafts are blocked with guidance.

- [ ] **M14-01** (C) Page token connect (keychain), page info + permission check.
- [ ] **M14-02** (C) Conversations sync (user-triggered).
- [ ] **M14-03** (C) Send API with 24 h window enforcement + rate-limit backoff.
- [ ] **M14-04** (A) `docs/guides/facebook-page-setup.md` (Meta app, permissions, long-lived Page token).
- [ ] **M14-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M14-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M14-report.md` sign-off. Scope: Facebook (fake Graph API + optional live): sync, send within window, 24 h BVA expiry, rate-limit backoff.

---

# v3 — Agentless Infrastructure Management (start only after M14; ADR-0004, ARCH Part III)

## M15 — SSH foundation & server registry

**Exit criteria:** user adds a Linux, a macOS and a Windows server (key file + optional passphrase), confirms the host-key fingerprint, and the card shows Online with detected OS; a changed host key blocks the connection.

- [ ] **M15-01** (C) `servers` table + repo + `server.*` CRUD RPC; `AppSettings.monitoring` (additive schema change, ADR-0004).
- [ ] **M15-02** (C) Key vault: AES-256-GCM encrypted key file + keychain data key/passphrase; import & validate key formats; zeroing.
- [ ] **M15-03** (C) `SshConnectionManager`: pooled ssh2 clients, ref-counted consumers, keepalive, reconnect backoff, idle close.
- [ ] **M15-04** (C) Host-key TOFU flow (fingerprint confirm RPC + notification), mismatch handling; OS detection.
- [ ] **M15-05** (C) AddServerModal + Servers tab skeleton (cards with connection state, fingerprint confirm dialog).
- [ ] **M15-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M15-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M15-report.md` sign-off. Scope: SSH foundation: add server (ed25519/RSA/passphrase EP), TOFU confirm, host-key mismatch blocks, reconnect, key vault encryption round trip (fake SSH server in tests).

## M16 — Metrics, monitoring & alerts

**Exit criteria:** cards show live CPU/RAM/net/disk/battery for all three OS families from fixtures and a real host; with background monitoring off, no SSH traffic occurs when the tab is hidden; with it on, a RAM > 90 % condition raises a toast.

- [ ] **M16-01** (C) Linux collector + pure parser (`/proc`, `/sys`, `df`) with fixtures.
- [ ] **M16-02** (C) macOS collector + parser (`vm_stat`, `sysctl`, `netstat -ib`, `pmset`).
- [ ] **M16-03** (C) Windows collector + parser (PowerShell CIM, JSON output).
- [ ] **M16-04** (C) `MetricsCollector` scheduler: watch/unwatch, background mode, single-flight, ring buffer, `server.metrics` notifications.
- [ ] **M16-05** (C) `AlertEngine`: rules, debounce, fire/resolve, `server.alert`; Tauri OS notifications (opt-in).
- [ ] **M16-06** (C) ServerCard UI: gauges, sparkline, net rates, disk, conditional battery, theme status tokens.
- [ ] **M16-07** (C) Settings → Monitoring: background toggle, interval, alert rules editor.
- [ ] **M16-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M16-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M16-report.md` sign-off. Scope: Metrics: parser fixtures for Linux/macOS/Windows, tab-visible vs background mode (no traffic when hidden & off), alert BVA + debounce, battery widget hidden when null.

## M17 — Docker management

**Exit criteria:** containers on a remote host listed; start/stop/restart work; logs stream smoothly at high volume without freezing the UI.

- [ ] **M17-01** (C) `DockerManager` over SSH `dial-stdio` (dockerode custom transport), availability check + remediation.
- [ ] **M17-02** (C) List/inspect/start/stop/restart + Docker events → refresh + container-exited alerts.
- [ ] **M17-03** (C) Log streaming (open/close, chunking, coalescing, back-pressure, auto-close).
- [ ] **M17-04** (C) ContainerDrawer UI: table, actions with confirmations, state chips.
- [ ] **M17-05** (C) Virtualized log viewer: auto-scroll toggle, filter, stdout/stderr toggle, download.
- [ ] **M17-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M17-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M17-report.md` sign-off. Scope: Docker: list/start/stop/restart via fake dial-stdio daemon, events → alerts, high-volume log stream without UI freeze (performance budget).

## M18 — Remote file manager

**Exit criteria:** browse, upload, download; edit `.env` and `docker-compose.yml` with diff + backup; a concurrent remote change is detected as a conflict; undo restores the backup.

- [ ] **M18-01** (C) `SftpService`: list/stat/read/mkdir/rename/delete (non-recursive), Windows path handling.
- [ ] **M18-02** (C) Safe write: hash conflict check, backup, tmp+rename, undo; binary detection; size limits.
- [ ] **M18-03** (C) Upload/download via native save/open dialogs (Tauri dialog plugin, command-scoped permission).
- [ ] **M18-04** (C) RemoteFileManager UI: dual pane, breadcrumbs, file table.
- [ ] **M18-05** (C) Monaco editor + diff-before-save + conflict resolution dialog.
- [ ] **M18-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M18-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M18-report.md` sign-off. Scope: SFTP: browse/upload/download, edit with diff + backup, conflict detection, undo, binary/size limits, Windows path handling.

## M19 — System actions

**Exit criteria:** reboot and shutdown work on all three OS families with typed-name confirmation, are audited, and the card tracks reboot progress.

- [ ] **M19-01** (C) `SystemActionService`: per-OS command catalog, `sudo -n` handling + remediation, audit log table.
- [ ] **M19-02** (C) Confirmation UI (type server name) + rebooting state tracking.
- [ ] **M19-03** (A) `docs/guides/server-setup.md`: SSH key setup, Tailscale notes, sudoers lines, Docker permissions, Windows OpenSSH, macOS remote login.
- [ ] **M19-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M19-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M19-report.md` sign-off. Scope: System actions: per-OS command catalog, sudo -n failure remediation, typed-name confirmation, audit log, reboot tracking.

> Deferred (not scheduled): AI agents operating servers — ARCH §23, needs a new ADR.

---

## Doc Debt

*(Contradictions or gaps found in docs; Architect resolves before the next task.)*

- none
