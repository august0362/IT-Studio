# ROADMAP.md — Milestones & Tasks

> **Continuing after a stop? Read `docs/HANDOFF.md` first** (status, in-flight work, process rules, environment).
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
| M3 Cost, pricing, FX, budget, P&L | **Done** (QA signed off) | 8 / 8 |
| M4 UI shell, Settings, Chat, P&L | **Done** (conditional — QA-E2E-FIX4) | 8 / 8 |
| M5 RAG | **Done** (conditional — QA-E2E-FIX4) | 8 / 8 |
| M6 Agent pipeline & Worker | **Done** (conditional — QA-E2E-FIX4) | 9 / 9 |
| M7 VS Code companion extension | **Done** (QA signed off) | 6 / 6 |
| MW Workflow map (v1 addendum) | In progress | 4 / 6 |
| WC Quick web chat (v1 addendum) | In progress | 0 / 1 |
| M8 Image generation | In progress (QA) | 5 / 6 |
| M9 Packaging & release | In progress (QA) | 6 / 7 |
| **v2** M10 Agent Orchestrator | Specified — waits for owner go-ahead | 0 / 11 |
| **v2** M11 Agent Memory | Specified | 0 / 9 |
| **v2** M12 Channels framework + Outbox + VS Code chat | Specified | 0 / 10 |
| **v2** M13 Gmail channel | Specified | 0 / 9 |
| **v2** M14 Facebook Page channel (+ REL-V2) | Specified | 0 / 7 |
| **v3** M15 SSH foundation & server registry | Specified | 0 / 8 |
| **v3** M16 Metrics, monitoring & alerts | Specified | 0 / 9 |
| **v3** M17 Docker management | Specified | 0 / 7 |
| **v3** M18 Remote file manager | Specified | 0 / 7 |
| **v3** M19 System actions (+ REL-V3) | Specified | 0 / 6 |

> v2/v3 planning baseline (2026-10-04): requirements `docs/specs/v2-requirements.md`, `docs/specs/v3-requirements.md`; plan (WBS, dependencies, risks) `docs/plans/v2-v3-delivery-plan.md`; every task below has a work order in `docs/tasks/<ID>.md`.

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
- [x] **M3-04** (C) Pricing updater (**manual only**, D9): `pricing.refresh` fetches sources, HTML→text, extraction via router (prompt ROLES §2.5), validation (bounds, max Δ%), apply/reject, `pricing.updated`; stale-table (> 30 days) reminder flag; set default `pricing.autoUpdate=false` in `domain/default-settings.ts`.
- [x] **M3-05** (C) `FxService`: daily fetch from `open.er-api.com` (no LLM), manual override, `fx.get`, `fx.override`; MoneyDisplay uses latest rate.
- [x] **M3-06** (C) `BudgetGuard` + budgets repo: estimate, levels, once-per-threshold alerts, Hard Stop rejection, `budget.set/status`. Ref: ARCH §6.4.
- [x] **M3-07** (C) Revenue entries (`revenue.add`, VND→µUSD at entry), `PnLService`, `pnl.get` breakdowns, **`pnl.getAll` aggregate across projects** (add RPC method + validator, D13).
- [x] **M3-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M3-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M3-report.md` sign-off. Scope: Ledger/P&L: cost frozen per price version, budget BVA (thresholds) × Hard Stop decision table, manual price update with validation reject, FX override, revenue in VND, per-project and aggregate P&L numbers vs hand-computed oracle.

## M4 — UI shell, Settings, Chat, P&L

**Exit criteria:** manual script `docs/qa/M4-smoke.md` passes: add key → chat streams → force fallback shows badge/modal → cost appears live in P&L in USD+VND.

- [x] **M4-00** (A) Resolve Q-01 — decided 2026-10-02: multiple open projects (tabs) + switcher, per-project P&L and aggregate P&L (D13).
- [x] **M4-01** (C) App shell: tabs (Chat, Code, Knowledge, Gallery-disabled, Cost & P&L, Settings), **project tabs** (open several projects, switch, close) + "All projects" entry, i18n scaffolding (en, vi) via react-i18next.
- [x] **M4-01b** (C) Theme system per `docs/design/THEMES.md` §5–§7: token CSS variables + Tailwind mapping, no-flash startup, system-mode listener, Settings → Theme picker (cards, filters, hover preview, a11y radiogroup), Monaco theme bridge, contrast test over all 36 theme/mode pairs, ban raw colors in components. (Data `config/themes.json` done by A.)
- [x] **M4-02** (C) Shared components: `<Money>`, `<SafeMarkdown>` (+ XSS test corpus), `<ErrorPanel>` (renders `AppError.remediation`).
- [x] **M4-03** (C) Settings: Router ladder (dnd-kit), **Auto Fallback** toggle, lock model, Budget (+ **Hard Stop** toggle), Pricing (table, refresh, override), FX (rate, override), VS Code options, Pipeline role assignment.
- [x] **M4-04** (C) Chat tab: conversation list, unified model dropdown (+ Lock), streaming with cancel, fallback badge + partial-reset handling, fallback modal (Auto OFF), per-message cost `<Money>`.
- [x] **M4-05** (C) Cost & P&L tab: revenue/cost/margin KPIs, charts by model/purpose/day (Recharts), budget bars with warning states, revenue entry form (USD/VND), ledger table with filters; live refresh on `ledger.entry`. Plus **All-projects dashboard**: per-project margin table, portfolio totals, top spend by project/model.
- [x] **M4-QA** (A+C) *(conditional sign-off — E2E follow-up QA-E2E-FIX2)* Milestone QA gate (TESTING.md §7): A writes `docs/qa/M4-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M4-report.md` sign-off. Scope: UI system tests: project tabs open/switch/close, theme switching (all 36 theme/mode pairs smoke + contrast), Settings flows, chat with fallback badge & modal, P&L dashboards; XSS corpus through chat rendering; keyboard-only navigation.

## M5 — RAG

**Exit criteria:** ingest `fixtures/docs` (md, pdf, docx, code) → re-ingest skips unchanged → question returns cited answer; embedding cost visible in P&L.

- [x] **M5-01** (C) Parsers: md, txt, code, pdf (pdfjs-dist), docx (mammoth), html; size/ext guards.
- [x] **M5-02** (C) Chunker (`domain/chunker.ts`): heading-aware + code-window, token target/overlap, `sectionPath`; property tests.
- [x] **M5-03** (C) `IEmbeddingProvider` (OpenAI, Google) + dispatcher with same-dimension fallback + ledger metering.
- [x] **M5-04** (C) LanceDB `IVectorStore` repo (per-project table, upsert, delete by doc, cosine search with filters).
- [x] **M5-05** (C) `RagService` ingest jobs: discovery, hash skip, progress events, per-file failure isolation, `rag.*` RPC.
- [x] **M5-06** (C) Retrieval: minScore filter, MMR, context injection, citation parts, `search_knowledge` tool; chat `ragEnabled` toggle.
- [x] **M5-07** (C) Knowledge tab: add files/folder, document list (format, chunks, model, date), re-index, delete, test-query panel.
- [x] **M5-QA** (A+C) *(conditional sign-off — E2E follow-up QA-E2E-FIX2)* Milestone QA gate (TESTING.md §7): A writes `docs/qa/M5-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M5-report.md` sign-off. Scope: RAG: ingest md/pdf/docx/code, unchanged-file skip, per-file failure isolation, cited answers, embedding cost in P&L, re-index on model change.

## M6 — Agent pipeline & Worker

**Exit criteria:** on `fixtures/sample-project`, a prompt reaches COMPLETED with files written and tests green; a forced failing validation produces ROLLED_BACK with byte-identical restore and a `FailureReport`; crash mid-commit recovers on restart.

- [x] **M6-01** (C) `resolveSafe` + `IFileSystem`; traversal test suite (`..`, absolute, UNC, drive, symlink escape, NUL, `.git`). Ref: ARCH §9.1.
- [x] **M6-02** (C) `WriteTransaction` Unit of Work: journal, baseHash check, patch apply, tmp+rename commit, rollback, crash recovery at startup. Ref: ARCH §9.2–§9.4.
- [x] **M6-03** (C) `CommandRunner` (`shell:false`, env scrub, timeout, tail) + parsers (tsc, eslint json, vitest json). Ref: ARCH §9.5.
- [x] **M6-04** (C) Role prompts (ROLES §2.1–2.3 verbatim), JSON schema generation from zod, output validation + single re-ask.
- [x] **M6-05** (C) `PipelineOrchestrator`: stage machine, role ladders, verdict rule, ≤ 1 fix round, per-project queue, cancel semantics, `pipeline.*` RPC + events. Ref: ARCH §8.1.
- [x] **M6-06** (C) `FailureReportBuilder` + remediation table for every `ErrorCode`.
- [x] **M6-08** (C) Pipeline cost attribution: `LlmRouter` forwards `pipelineRunId` to the ledger; `PipelineRun` cost = sum of its ledger rows (follow-up from M6-05 QA).
- [x] **M6-07** (C) Code tab: prompt box, stage timeline, spec/review viewers, Monaco diff viewer, live command output, failure report panel, run history.
- [x] **M6-QA** (A+C) *(conditional sign-off — E2E follow-up QA-E2E-FIX2)* Milestone QA gate (TESTING.md §7): A writes `docs/qa/M6-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M6-report.md` sign-off. Scope: Pipeline: happy path to COMPLETED, review-reject → fix → approve, failing validation → byte-identical rollback, crash mid-commit recovery, path-traversal corpus, cancel at every stage; StrykerJS on worker/domain (score reported). **Carry-over:** case-insensitive `</context>` neutralisation (from M6-04 QA); chunker branch coverage ≥ 90 % (from M5-02 QA) belongs to M5-QA.

## M7 — VS Code companion extension

**Exit criteria:** starting a pipeline auto-opens VS Code on the project, changed files are revealed with diff, diagnostics appear in the app; closing VS Code mid-run does not fail the run.

- [x] **M7-01** (C) Extension skeleton: activation on `workspaceContains:.itstudio/session.json`, WS client, `ExtHello`, reconnect, status bar item.
- [x] **M7-02** (C) Sidecar `VSCodeBridge`: WS server on loopback, token (constant-time), Origin rejection, heartbeat, `vscode.status`. Ref: ARCH §10.1.
- [x] **M7-03** (C) Launcher (`code` resolve, `shell:false`) + installer (`--list-extensions`, `--install-extension` bundled vsix) + vsix build script; `.itstudio/` gitignore guard.
- [x] **M7-04** (C) `reveal`, `show_diff`, `transaction` decorations, `notify`.
- [x] **M7-05** (C) Diagnostics streaming (debounced) + `file_saved_by_user` → stale-run conflict marking.
- [x] **M7-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M7-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M7-report.md` sign-off. Scope: VS Code (`@vscode/test-electron`): auto-launch, handshake, reveal/diff on commit, diagnostics forwarded, VS Code closed mid-run does not fail the pipeline, bad token rejected.

## MW — Workflow map *(v1 addendum, D32 — start after the v1 hand-over, on the user's go-ahead)*
Ref: ARCHITECTURE §13.1, schemas §12b. Per-project graph of modules, links and data contracts; click a module → realtime in-flight work + history + metrics + deep links.

- [x] **MW-00** (A) Pre-install `@xyflow/react`; task specs MW-01…MW-04; test-case spec `docs/qa/MW-test-cases.md`.
- [x] **MW-01** (C) Sidecar: `domain/workflow-topology.ts` (static catalogue of nodes / lanes / typed edges), `services/activity-recorder.ts` (maps existing events → `ActivityEvent`, redaction, in-flight sets, batching ≤ 4/s), `activity_events` table + retention (7 d / 20 000 per project), RPC `workflow.graph`, `workflow.activity`, notification `workflow.activity` + validators.
- [x] **MW-02** (C) Workflow tab: React Flow graph by lanes, theme tokens, node status / counters, edge animation on live events, zoom / pan / fit, keyboard navigation, "All projects" aggregate with project filter chips.
- [x] **MW-03** (C) Module side panel: Now (in-flight with progress), Recent (filters, load-more from history), Metrics 24 h (calls, errors, p50 / p95, cost via `<Money>`), Links in / out with contract + last payload summary, deep links to Chat / Code / Knowledge / Cost.
- [~] **MW-04** (C) *(implemented on branch `task/MW-04`, unit green; integration + E2E pending — see `docs/HANDOFF.md` §4.2)* Missing events: add only the events the recorder cannot derive today (e.g. retriever query / hits count, command start / end, VS Code action acks) as in-process events — no polling.
- [ ] **MW-QA** (A+C) QA gate (TESTING.md §7): topology completeness vs ARCH §13.1, event → module mapping table, redaction corpus (no prompt text / keys in any summary), retention boundaries, UI live update under load (100 events/s burst), E2E: run a chat + an ingest + a pipeline and see the right nodes / edges light up and the panel history match.

## WC — Quick web chat *(v1 addendum, D34)*
Open ChatGPT / Gemini / Grok / … in the owner's browser (default Cốc Cốc) from IT Studio; copy a project brief to paste. No scraping, no metering.

- [ ] **WC-01** (C) Web chat links + browser locator + `webchat.*` RPC + Chat header menu + Settings → Web chat; upgrade-safe settings defaults.

## M8 — Image generation *(deferred — do not start without user go-ahead)*

Spec: ARCH §14.1, `schemas.ts` §13.

- [x] **M8-01** (C) `IImageProvider` port + DALL·E 3 adapter.
- [x] **M8-02** (C) FLUX adapters (Together sync, Replicate polling); Midjourney adapter compiled but disabled.
- [x] **M8-03** (C) `generate_image` tool dispatch: validation, BudgetGuard, provider fallback, download-and-store, ledger (`purpose=image`).
- [x] **M8-04** (C) Chat inline image rendering via asset protocol.
- [x] **M8-05** (C) Gallery tab.
- [~] **M8-QA** (A+C) *(automated on branch `task/M8-QA`; L3 111/111 green; E2E TC-M8-010 failing — see `docs/HANDOFF.md` §4.1)* Milestone QA gate (TESTING.md §7): A writes `docs/qa/M8-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M8-report.md` sign-off. Scope: Image generation: tool call → image stored locally, provider fallback, cost per image, gallery.

## M9 — Packaging & release *(deferred)*

Spec: ARCH §14.2.

- [x] **SEC-01** (A+C) Dependency audit hardening before release: production audit (2026-10-02) = 3 high, all from @lancedb/lancedb → @huggingface/transformers → sharp (libvips CVE-2026-33327/33328/35590/35591). Options: npm `overrides` to a patched sharp, or exclude the optional transformers dependency; add `npm audit --omit=dev --audit-level=high` to the release checklist. Also (2026-10-02): low — dompurify (IN_PLACE hook XSS) via monaco-editor 0.57; upgrade when monaco ships a patched dompurify.
- [x] **PERF-01** (C) Sidecar cold start: dev start ≈ 4 s before `main` runs (html-to-text ≈ 1.7 s, LanceDB, parsers). Lazy-load heavy modules on first use; run the E2E crash hook before importing the container; target < 1.5 s in dev, measure the M9 bundle. UI: lazy-load the Cost tab (Recharts) — main chunk 1.13 MB after M4-03. Integration TC-M1-033 (4 sequential sidecar starts) hit its 30 s timeout once. *(dev: 3.97 s → 2.82 s, main chunk 684 kB; < 1.5 s target moves to the M9 bundle)*
- [x] **QA-E2E-FIX2** (C) Finish the remaining E2E cases (TC-M4-023/031/043-046, TC-M5-022/023, TC-M6-070-072): give the Code E2E project a passing validation command, isolate each spec session (fresh data dir per spec or full settings reset), fix the fallback-modal and budget assertions. Product behaviour for all of them passes at L2/L3.
- [ ] **QA-E2E-FIX4** (C) *(backlog — skipped after 6 attempts, 2026-10-03)* Remaining E2E: TC-M4-022/023/031/033/041-046, TC-M5-020/022/023, TC-M6-071/072. Needs a different approach: run each spec in a fresh app + data dir (per-spec tauri-driver restart) and capture a DOM snapshot + screenshot on failure so fixes are not blind. Also fix `scripts/dev/measure-startup.mjs` (no stdin pipe → sidecar exits before ready).
- [ ] **QA-TOOL-01** (C) Make StrykerJS mutation testing work with the Vitest 5 workspace (currently reports 0 % kills; manual mutation proves the tests are effective).
- [x] **M9-01** (C) esbuild sidecar bundle + Node SEA build script; native module loading from resources.
- [x] **M9-02** (C) Tauri `externalBin` + resources (vsix, seeds); production sidecar spawn path.
- [x] **M9-03** (C) NSIS + MSI bundles; WebView2 bootstrapper.
- [x] **M9-04** (A) *(not needed — D33 single user; updater key pair deferred until auto-update is wanted)* Code-signing setup (user supplies certificate) + updater key pair (private key outside repo).
- [x] **M9-05** (C) Version bump script (4 manifests) + release CHANGELOG automation.
- [x] **M9-06** (C) *(D33: replaced by an isolated install smoke — no system Node on PATH, no repo node_modules reachable)* Clean-VM smoke test checklist and execution.
- [ ] **M9-QA** (A+C) Milestone QA gate (TESTING.md §7): A writes `docs/qa/M9-test-cases.md` (black-box + white-box, traceability) → C automates L3/L4 → A executes, exploratory session, `docs/qa/M9-report.md` sign-off. Scope: Packaging: install on clean VM, first run, sidecar SEA starts, native modules load, update flow.

---

# v2 — Multi-Agent & Omnichannel Hub (ADR-0003, ARCH Part II, SRS `docs/specs/v2-requirements.md`)

> Start only on the owner's go-ahead after v1 hands-on testing (HANDOFF §3 rule 7). Each milestone starts with an Architect `Mx-00` (contracts, dependencies, open questions) and ends with its QA gate. Requirement IDs (FR-…) refer to the SRS. Dependencies and lanes: `docs/plans/v2-v3-delivery-plan.md` §2.

## M10 — Agent Orchestrator

**Exit criteria:** user creates a custom agent in the Agent Builder and chats with it; the v1 pipeline runs as an agent team with unchanged behaviour; agent costs appear in P&L; `start_pipeline` never runs without the user's confirmation.

- [ ] **M10-00** (A) Contracts (ErrorCode, ToolName, CostPurpose, optional fields), `config/agents.seed.json` (6 templates), task review.
- [ ] **M10-01** (C) Agent registry: `agents` + `project_agent_defaults` tables, seeding, validation, `agents.*` CRUD/clone, project default. *FR-AG-01…05*
- [ ] **M10-02** (C) Tool policy (pure decision table) + agent tool registry (`search_knowledge`, stubs). *FR-AG-07/08*
- [ ] **M10-03** (C) `AgentRunner` (context, tool loop ≤ 6, cancel), `agent_runs`, chat integration, ledger purpose `agent`. *FR-AG-06/10/11/16*
- [ ] **M10-04** (C) `start_pipeline` with user confirmation (`awaiting_approval`). *FR-AG-09, DD-V2-02*
- [ ] **M10-05** (C) Routing rules repo + pure matcher + `routing.*` RPC. *FR-AG-13*
- [ ] **M10-06** (C) Code pipeline as PM/Coder/QA agent team + role-assignment migration (M6 regression). *FR-AG-12*
- [ ] **M10-07** (C) Settings → Agents (Agent Builder) + routing rules editor. *FR-AG-14*
- [ ] **M10-08** (C) Chat agent picker, project default, run cost, tool cards, pipeline confirmation card. *FR-AG-15*
- [ ] **M10-09** (C) Workflow map: Agent runner module. *FR-WF2-01/02*
- [ ] **M10-QA** (A+C) Milestone QA gate (TESTING.md §7) — outline in `docs/tasks/M10-QA.md`.

## M11 — Agent Memory

**Exit criteria:** after a conversation the agent recalls a stated preference in a new conversation; the user can view/edit/pin/delete it; nothing is extracted from external channels by default; no LLM call happens without a user action.

- [ ] **M11-00** (A) Contracts, shared secret-pattern source, task review.
- [ ] **M11-01** (C) Memory store: SQLite `memories` + LanceDB `memories_<agentId>` (explicit schema), repair. *FR-MEM-01*
- [ ] **M11-02** (C) Memory filter (secrets / third-party PII) + dedupe rules (pure). *FR-MEM-04/05*
- [ ] **M11-03** (C) Extraction service, `chat.closeConversation`, pending extraction on exit. *FR-MEM-02/03, DD-V2-03*
- [ ] **M11-04** (C) Recall scoring, `<context name="memory">` injection, `recall_memory` tool. *FR-MEM-06/07*
- [ ] **M11-05** (C) Explicit remember: en/vi phrase, message action, `remember` tool. *FR-MEM-08*
- [ ] **M11-06** (C) `memory.*` RPC (list/search/CRUD/pin/forgetAll/export/cleanup/extractNow). *FR-MEM-09*
- [ ] **M11-07** (C) Memory page UI. *FR-MEM-10*
- [ ] **M11-QA** (A+C) Milestone QA gate — outline in `docs/tasks/M11-QA.md`.

## M12 — Channels framework, Outbox, VS Code chat

**Exit criteria:** a fake adapter syncs on click, an agent drafts a reply into the Outbox, nothing is sent until approved (max 20/h/account); the VS Code chat panel talks to agents; the injection corpus causes no send, no forbidden tool, no memory write.

- [ ] **M12-00** (A) Contracts (error codes, protocol v2 types), `markdown-it` for the extension, fake-channel script format.
- [ ] **M12-01** (C) `IChannelAdapter` port, tables, repositories, fake adapter, contract suite. *FR-CH-01/04*
- [ ] **M12-02** (C) `ChannelService` + `channels.*` (accounts, user-triggered sync, messages). *FR-CH-02/03*
- [ ] **M12-03** (C) Outbox: pure state machine, send cap, `outbox.*`, `draft_reply` tool, crash-safe send. *FR-OB-01…07*
- [ ] **M12-04** (C) Triage (batch ≤ 20, confirm before apply) + *Process* via routing → AgentRunner (external restrictions). *FR-CH-05/06*
- [ ] **M12-05** (C) Inbox tab UI (Inbound / Outbox, badges, approve/edit/reject). *FR-CH-07*
- [ ] **M12-06** (C) VS Code protocol v2 — sidecar side (chat routing, streaming, v1 compatibility). *FR-CH-08/09*
- [ ] **M12-07** (C) VS Code extension chat panel (webview, CSP, sanitized markdown). *FR-CH-08/10*
- [ ] **M12-08** (C) Workflow map: Channels, Triage, Outbox, Memory modules. *FR-WF2-01/02*
- [ ] **M12-QA** (A+C) Milestone QA gate — outline in `docs/tasks/M12-QA.md`.

## M13 — Gmail channel

**Exit criteria:** on click, new mail is fetched; triage labels it after confirmation; an agent drafts a reply; approve sends it in-thread; an `[ITS]` email from the owner's own address with DKIM pass becomes a command that runs only after in-app confirmation.

- [ ] **M13-00** (A) `mailparser`, opener allow-list for Google auth, `config/channels.json`, Q-06/Q-08.
- [ ] **M13-01** (C) OAuth installed-app flow (PKCE, loopback), refresh token in keychain, connect/disconnect. *FR-GM-01/02*
- [ ] **M13-02** (C) Gmail client + sync (`history.list` / `messages.list`) + MIME → text. *FR-GM-03/04*
- [ ] **M13-03** (C) RFC 5322 composition + threaded send. *FR-GM-05*
- [ ] **M13-04** (C) `ITStudio/*` labels after triage confirmation. *FR-GM-06*
- [ ] **M13-05** (C) Email commands: policy (sender × prefix × DKIM) + confirmed run. *FR-GM-07/08*
- [ ] **M13-06** (C) "Email me this report" (P&L, failure report, overnight summary). *FR-GM-09*
- [ ] **M13-07** (A) `docs/guides/gmail-setup.md`.
- [ ] **M13-QA** (A+C) Milestone QA gate — outline in `docs/tasks/M13-QA.md`.

## M14 — Facebook Page channel

**Exit criteria:** on click, new Page conversations are fetched; an agent drafts; approve sends within the 24 h window; expired drafts are blocked with guidance; rate limits back off.

- [ ] **M14-00** (A) Contracts, Graph version pin, Q-07, verify Meta rules.
- [ ] **M14-01** (C) Page token connect + validation + keychain. *FR-FB-01/06*
- [ ] **M14-02** (C) Conversations sync (user-triggered). *FR-FB-02*
- [ ] **M14-03** (C) Send with 24 h window + rate-limit backoff. *FR-FB-03/04/05*
- [ ] **M14-04** (A) `docs/guides/facebook-page-setup.md`.
- [ ] **M14-QA** (A+C) Milestone QA gate + v2 regression — outline in `docs/tasks/M14-QA.md`.
- [ ] **REL-V2** (A+C) Release v2.0.0: upgrade test from v1 data, audit, bump, installers, install smoke.

---

# v3 — Agentless Infrastructure Management (ADR-0004, ARCH Part III, SRS `docs/specs/v3-requirements.md`)

> Starts after REL-V2, or earlier if the owner prefers (no functional dependency on v2). Servers are app-global (DD-V3-01, Q-09).

## M15 — SSH foundation & server registry

**Exit criteria:** user adds a Linux, a macOS and a Windows server (key file + optional passphrase), confirms the host-key fingerprint, and the card shows Online with detected OS; a changed host key blocks the connection before authentication.

- [ ] **M15-00** (A) `ssh2`, dialog plugin, SEA check, contracts (`AppSettings.monitoring`, error codes), Q-09/Q-10.
- [ ] **M15-01** (C) Server registry + validation + monitoring defaults. *FR-SV-01/02*
- [ ] **M15-02** (C) Key vault: import, AES-256-GCM envelope, keychain data key, zeroing. *FR-KV-01…03*
- [ ] **M15-03** (C) Pure SSH connection machine + pooled connection manager + fake SSH server harness. *FR-SV-03/04/08*
- [ ] **M15-04** (C) Host-key TOFU, OS detection, fixed remote command catalog. *FR-SV-05…07*
- [ ] **M15-05** (C) Servers tab skeleton, AddServerModal, host-key dialog. *FR-SV-09*
- [ ] **M15-06** (C) Workflow map: infra lane. *FR-WF3-01/02*
- [ ] **M15-QA** (A+C) Milestone QA gate — outline in `docs/tasks/M15-QA.md`.

## M16 — Metrics, monitoring & alerts

**Exit criteria:** cards show live CPU/RAM/net/disk/battery for all three OS families from fixtures and a real host; with background monitoring off, no SSH traffic occurs when the tab is hidden; with it on, a RAM > 90 % condition raises a toast.

- [ ] **M16-00** (A) Notification plugin, scrubbed real-host fixtures, contracts.
- [ ] **M16-01** (C) Linux collector + pure parser. *FR-MT-01/04/05*
- [ ] **M16-02** (C) macOS collector + parser. *FR-MT-02*
- [ ] **M16-03** (C) Windows collector + parser (PowerShell JSON). *FR-MT-03*
- [ ] **M16-04** (C) `MetricsCollector` scheduler: watch/unwatch, background mode, single-flight, ring buffer. *FR-MT-06…08*
- [ ] **M16-05** (C) Pure alert engine (debounce, fire/resolve) + alert service. *FR-AL-01/02*
- [ ] **M16-06** (C) ServerCard metrics UI, alert toasts/center, OS notifications. *FR-MT-09, FR-AL-03*
- [ ] **M16-07** (C) Settings → Monitoring. *FR-MT-10*
- [ ] **M16-QA** (A+C) Milestone QA gate — outline in `docs/tasks/M16-QA.md`.

## M17 — Docker management

**Exit criteria:** containers on a remote host listed; start/stop/restart work; unexpected exits alert; logs stream smoothly at high volume without freezing the UI.

- [ ] **M17-00** (A) `dockerode`, `react-virtuoso`, fake Docker Engine plan, contracts.
- [ ] **M17-01** (C) `DockerManager` over SSH `dial-stdio` + availability check. *FR-DK-01/02*
- [ ] **M17-02** (C) List/inspect/actions + Docker events → refresh + container-exited alerts. *FR-DK-03/04*
- [ ] **M17-03** (C) Log streaming (demux, coalescing, back-pressure, auto-close). *FR-DK-05*
- [ ] **M17-04** (C) ContainerDrawer UI. *FR-DK-06*
- [ ] **M17-05** (C) Virtualised log viewer. *FR-DK-07*
- [ ] **M17-QA** (A+C) Milestone QA gate — outline in `docs/tasks/M17-QA.md`.

## M18 — Remote file manager

**Exit criteria:** browse, upload, download; edit `.env` and `docker-compose.yml` with diff + backup; a concurrent remote change is detected as a conflict; undo restores the backup; a dropped connection mid-save never truncates the file.

- [ ] **M18-00** (A) Contracts, fake SFTP harness plan.
- [ ] **M18-01** (C) `SftpService` browse ops + pure remote path rules (incl. Windows hosts). *FR-FS-01/05*
- [ ] **M18-02** (C) Read + safe write (hash check, backup, atomic rename) + undo. *FR-FS-02…04*
- [ ] **M18-03** (C) Upload/download with progress and cancel (dialog-chosen paths). *FR-FS-06*
- [ ] **M18-04** (C) RemoteFileManager UI. *FR-FS-07*
- [ ] **M18-05** (C) Monaco editor, diff before save, conflict dialog, undo. *FR-FS-08*
- [ ] **M18-QA** (A+C) Milestone QA gate — outline in `docs/tasks/M18-QA.md`.

## M19 — System actions

**Exit criteria:** reboot and shutdown work on all three OS families with typed-name confirmation, are audited, and the card tracks reboot progress.

- [ ] **M19-00** (A) Contracts, sudoers lines per OS.
- [ ] **M19-01** (C) `SystemActionService` (catalog, `sudo -n` remediation, audit log, rebooting tracking). *FR-SA-01…04*
- [ ] **M19-02** (C) Confirmation UI (type server name), rebooting state, audit view. *FR-SA-02…04*
- [ ] **M19-03** (A) `docs/guides/server-setup.md`. *FR-SA-05*
- [ ] **M19-QA** (A+C) Milestone QA gate + v3 regression — outline in `docs/tasks/M19-QA.md`.
- [ ] **REL-V3** (A+C) Release v3.0.0.

> Deferred (not scheduled): AI agents operating servers — ARCH §23, needs a new ADR.

---

## Doc Debt

*(Contradictions or gaps found in docs; Architect resolves before the next task.)*

- **DD-V3-01 / D13:** D13 says every persisted entity carries `projectId`; v3 servers (`ServerConfig`, approved in ADR-0004) have none. Proposed clarification: D13 applies to project work; infrastructure (servers, server actions) is app-global. Confirm with the owner (Q-09) in M15-00, then add the clarification to CONTEXT D13.
