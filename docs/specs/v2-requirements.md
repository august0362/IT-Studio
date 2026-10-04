# v2 Software Requirements Specification — Multi-Agent & Omnichannel Hub (M10–M14)

> Structure follows ISO/IEC/IEEE 29148 (SRS). Owner: Architect (Claude). Status: **Baseline 1.0 — 2026-10-04**, approved scope = CONTEXT D18–D23, ADR-0003.
> Binding inputs: `CONTEXT.md` §3, `ARCHITECTURE.md` Part II (§15–§17), `ROLES.md` §2.8–§2.9, `schemas.ts` §14–§16.
> This document adds what those leave open: numbered requirements, exact interface contracts, data model, state machines, error codes, non-functional targets and traceability. Task files (`docs/tasks/M1x-*.md`) cite requirements by ID (`FR-AG-03`).
> Delivery plan (WBS, dependencies, estimates, risks): `docs/plans/v2-v3-delivery-plan.md`.

---

## 1. Introduction

### 1.1 Purpose
Turn the v1 desktop app (chat, RAG, code pipeline, cost/P&L) into a hub where **configurable agents** with **long-term memory** handle work coming from the app, VS Code, Gmail and a Facebook Page — while keeping every token spent and every outbound message under the owner's explicit control.

### 1.2 Scope
In scope: agents (registry, builder, runner, tools, routing), agent memory, channel framework, Outbox approval, triage, VS Code chat panel, Gmail channel, Facebook Page channel, Workflow-map coverage of the new modules, v2.0.0 release.
Out of scope: supervisor/auto-delegating agents, background polling or schedulers for channels (D21), personal Facebook accounts, attachments download, multi-user, AI agents on servers (v3+, ARCH §23).

### 1.3 Stakeholders
| Stakeholder | Interest |
|---|---|
| Owner (single user, D14/D33) | Fewer manual steps, no surprise spend, no wrong sends, Vietnamese + English UI |
| Architect / QA (Claude) | Testable, traceable requirements; contracts first |
| Implementer (Codex) | Unambiguous task scopes and contracts |
| External parties (email senders, Page customers) | Correct, approved replies; privacy of their data |

### 1.4 Definitions
See `CONTEXT.md` §5 (Agent, Agent Memory, Channel, Outbox). Additional: **Turn** = one `AgentRun`; **External trigger** = run whose input originated in `EXTERNAL_CHANNELS`; **Untrusted content** = any text from an external channel; **Command candidate** = inbound Gmail message passing D23 sender + prefix checks (DKIM evaluated separately).

### 1.5 Design decisions taken in this SRS (within approved scope; no ADR needed)
| ID | Decision | Rationale |
|---|---|---|
| DD-V2-01 | Chat conversations get an optional `agentId`; no agent = v1 "Chat Assistant" behaviour. | Backwards compatible; additive field. |
| DD-V2-02 | `start_pipeline` from an agent **never starts a run directly**: the run is created only after the user clicks *Start* on a confirmation card (`AgentRun.status = awaiting_approval`). | D21 (cost only on user action), D22 spirit. |
| DD-V2-03 | Memory auto-extraction runs when the user **switches away from or closes** a conversation (UI calls `chat.closeConversation`). On app exit extraction is **not** run (5 s shutdown budget); the conversation is flagged `pendingExtraction` and extracted the next time the user opens it or clicks *Extract now*. | D21: no LLM call without a user action; ARCH §2.3 shutdown budget. |
| DD-V2-04 | SQLite is the source of truth for memories; LanceDB rows are derived and repaired by *Clean up*. | Recoverability. |
| DD-V2-05 | Channel accounts belong to one project (`ChannelAccount.projectId`); their LLM cost goes to that project (D13, D31 pattern). | P&L attribution. |
| DD-V2-06 | Gmail/Graph APIs are called through the existing `IHttpClient` port (fetch) — no Google/Meta SDK. Inbound MIME parsing uses `mailparser`; outbound RFC 5322 messages are composed by a pure domain function. | Small dependency surface, testable with msw. |
| DD-V2-07 | OAuth consent page is opened by the **UI** through the Tauri opener plugin with a URL allow-list (`https://accounts.google.com/*`); the sidecar runs the loopback listener. | Sidecar has no browser access; opener already shipped (M8). |
| DD-V2-08 | VS Code protocol v2 is a superset of v1; the sidecar accepts both `protocolVersion` 1 and 2; chat-panel messages are only sent to v2 clients. | Older extension keeps working. |
| DD-V2-09 | Remember-phrase detection is bilingual: `remember …`, `remember that …`, `hãy nhớ …`, `nhớ rằng …` (case-insensitive, at start of message). | Owner writes in Vietnamese. |

---

## 2. Overall description

### 2.1 Product perspective
Extends the Node sidecar (D1) with three subsystems — Agent Orchestrator, Agent Memory, Channels/Outbox — all behind JSON-RPC. No new process; no new network listener except the **short-lived OAuth loopback** (M13, 127.0.0.1 only, ≤ 5 min).

### 2.2 User classes and characteristics
One owner, technical, bilingual (vi/en), cost-sensitive. Uses keyboard and mouse; expects every external effect to be reviewable.

### 2.3 Operating environment
As v1: Windows 11, packaged app (M9), app data in `%APPDATA%\com.itstudio.app`, keys in Windows Credential Manager.

### 2.4 Constraints
C-1 On-demand only (D21). C-2 Outbox approval for every external send (D22). C-3 Restricted tools for external triggers (ARCH §15.2). C-4 Contracts additive only (CONVENTIONS §2). C-5 Keys/tokens only in keychain (D2). C-6 Money integer µUSD (ARCH §6). C-7 All UI strings i18n en + vi; theme tokens only.

### 2.5 Assumptions and dependencies
A-1 Owner creates a Google Cloud OAuth client (Desktop type) and a Meta app + Page token (guides M13-07, M14-04). A-2 Gmail API and Graph API v21+ remain compatible. A-3 Existing router supports tool calls (fixed in M8-03).

---

## 3. Functional requirements

Priority: **M** = must (release blocker), **S** = should, **C** = could. Every requirement is verified by at least one test case in the milestone QA document (`docs/qa/M1x-test-cases.md`); IDs below are traced in §9.

### 3.1 Agents (M10) — `FR-AG`
| ID | Requirement | Pri |
|---|---|---|
| FR-AG-01 | On first start after upgrade the sidecar seeds 6 built-in agents from `config/agents.seed.json` (PM, Architect, Coder, QA, Email Assistant, Page Support), idempotently (re-seeding never duplicates and never overwrites user edits to clones). | M |
| FR-AG-02 | Built-in agents are read-only except `enabled`; *Clone* creates a `custom` copy with a new id and name "<name> (copy)". Deleting a built-in returns `VALIDATION`. | M |
| FR-AG-03 | Create/update validates: name 1–60 chars unique (case-insensitive); `systemPrompt` 1–8 000 chars; `modelLadder` 1–5 existing, enabled `ModelKey`s with `chat` capability (and `tool_calling` if `tools` non-empty); `tools` ⊆ `AgentToolName`; `channels` ⊆ `ChannelKind`; `memory.recallTopK` 0–20. | M |
| FR-AG-04 | Every agent system prompt sent to a model = user persona + the non-editable common rules (ROLES §2 common rules, `<context>` data rule) + tool usage guidance. The UI shows the appended rules read-only. | M |
| FR-AG-05 | A conversation may be bound to an agent (`Conversation.agentId`). Each project has a default agent (`Project`-scoped setting `defaultAgentId`, nullable). New conversations use the project default. | M |
| FR-AG-06 | `AgentRunner` executes one turn: budget check → context (system prompt, recalled memories, optional RAG hits, last N turns capped at 60 % of the model context window) → router with `ladderOverride = agent.modelLadder` → tool loop. | M |
| FR-AG-07 | Tool loop: at most **6** tool calls per run; the 7th request is not executed and the run completes with the text so far plus a notice. Tool arguments are zod-validated; invalid → `tool_result{isError:true}` returned to the model (counts toward the limit). | M |
| FR-AG-08 | Tool availability = `agent.tools ∩ allowedFor(trigger)`. External triggers allow only `search_knowledge`, `recall_memory`, `draft_reply`. A forged call to a non-allowed tool is rejected with `TOOL_NOT_ALLOWED` and logged. | M |
| FR-AG-09 | `start_pipeline` (UI/VS Code triggers only) creates a confirmation card; the run waits in `awaiting_approval`; *Start* calls `pipeline.start` with the drafted prompt (editable); *Dismiss* completes the run. (DD-V2-02) | M |
| FR-AG-10 | Every run persists an `AgentRun` (`agent_runs` table) with tool calls, recalled memory ids, outbox ids, cost (sum of its ledger rows) and error. Runs are listed per conversation and per agent. | M |
| FR-AG-11 | Ledger purposes `agent`, `memory_extraction`, `triage` exist; agent turns are billed as `agent`; P&L breakdown shows them with i18n labels. | M |
| FR-AG-12 | The v1 code pipeline uses the PM, Coder and QA agents' ladders as its role assignment (QA = reviewer). Existing `settings.pipeline.roleAssignment` is migrated once into those agents; afterwards Settings → Pipeline shows the three agents (link to edit). Stage machine, prompts and verdict rule are unchanged (M6 regression suite green). | M |
| FR-AG-13 | Routing rules (`RoutingRule`) are ordered; first enabled match wins; matching is case-insensitive substring on from/subject/text; no match → account `defaultAgentId` → else the UI asks the user to choose. Max 100 rules. | M |
| FR-AG-14 | Agent Builder UI: list (built-in badge, enabled toggle), clone, create, edit (persona, ladder with drag reorder, tools checklist with external-safety hints, channels, memory policy), delete custom (confirm). Keyboard accessible. | M |
| FR-AG-15 | Chat header agent picker (per conversation) and per-project default selector; each assistant message shows agent name, model and cost; tool calls render as cards (search hits count, memory recalled count, draft created → link to Outbox, pipeline confirmation). | M |
| FR-AG-16 | Cancelling a run (`agents.cancelRun`) aborts the in-flight router request and pending tool calls; status `cancelled`; billed partial usage still recorded. | S |

### 3.2 Agent memory (M11) — `FR-MEM`
| ID | Requirement | Pri |
|---|---|---|
| FR-MEM-01 | Memories are stored in SQLite `memories` (metadata) and LanceDB `memories_<agentId>` (vector + id), embedding model = `settings.rag.embedding`. | M |
| FR-MEM-02 | Auto-extraction (DD-V2-03): when the user closes/switches a conversation with ≥ 2 user turns since the last extraction and the agent's `memory.enabled && autoExtract`, run the Memory Extractor prompt (ROLES §2.8) on the new turns with the cheapest JSON-capable model, purpose `memory_extraction`. | M |
| FR-MEM-03 | Turns whose trigger is external are excluded unless `extractFromExternalChannels` (default false). | M |
| FR-MEM-04 | Candidate filter rejects text matching the secret-scanner pattern set, and — for channel sources — third-party email addresses/phone numbers. Rejections are counted, never stored. | M |
| FR-MEM-05 | De-duplication: cosine ≥ 0.92 against the same agent + scope → update existing (keep longer text, max importance, `updatedAt` now) instead of insert. | M |
| FR-MEM-06 | Recall per ARCH §16.3: `score = cosine × (0.6 + 0.1·importance) × 0.5^(days/90)`; cosine floor 0.3; top `recallTopK`; pinned items always included (max 5, counted within topK when possible); expired excluded; `lastRecalledAt` updated. | M |
| FR-MEM-07 | Recalled memories are injected as `<context name="memory">` (data, not instructions) and their ids stored on the `AgentRun`. | M |
| FR-MEM-08 | Explicit remember: a user message starting with a remember phrase (DD-V2-09), the *Remember* message action, or the `remember` tool (non-external triggers only) stores a memory (kind inferred: `instruction` if imperative, else `fact`; importance 3; user may edit). | M |
| FR-MEM-09 | `memory.*` RPC: list (filter agent, project, kind, text search, paging), search (vector, returns hits with score), create, update (text/importance/kind/expiry → re-embed on text change), pin/unpin, delete, forgetAll(agentId) (confirm token), export (JSON of items, no vectors), cleanup (purge expired, re-embed items whose model differs, repair LanceDB/SQLite drift). | M |
| FR-MEM-10 | Memory page: agent + project filters, kind chips, search, table (text, kind, importance, pinned, source, created, last recalled), inline edit, pin, delete, *Forget everything* (type agent name), *Export*, *Clean up*, *Extract now* for pending conversations. | M |
| FR-MEM-11 | Memory never contains secrets in any output: RPC, logs, activity summaries (Workflow map shows counts only). | M |

### 3.3 Channels framework & Outbox (M12) — `FR-CH`, `FR-OB`
| ID | Requirement | Pri |
|---|---|---|
| FR-CH-01 | `IChannelAdapter` (ARCH §17.1) with a shared contract test suite (`providers/channel/__contract__/`) that every adapter (fake, gmail, facebook) passes. | M |
| FR-CH-02 | `channels.sync(accountId)` runs only from an RPC call (user action). No timers. It stores new messages idempotently (unique `(accountId, externalMessageId)`), sets `triage = untriaged`, updates `lastSyncedAt`, emits `channels.synced{accountId, newCount}`. | M |
| FR-CH-03 | Sync is single-flight per account (second call while running returns the running job's result). | M |
| FR-CH-04 | Inbound text is stored plain (HTML stripped, ≤ 100 000 chars, truncated with marker). | M |
| FR-CH-05 | `channels.triage(accountId | messageIds)` batches ≤ 20 messages per LLM call with the Triage prompt (ROLES §2.9), purpose `triage`, cheapest JSON model; results applied only after the user confirms in the UI (Gmail labels in M13 depend on this). | M |
| FR-CH-06 | `channels.process(messageId)` resolves the agent via routing (FR-AG-13) and starts an `AgentRun` with `trigger = channel_action`, external restrictions, content wrapped in `<context source="external">`. | M |
| FR-OB-01 | Outbox state machine (§7.2) enforced by a pure transition table; illegal transitions → `CONFLICT`. | M |
| FR-OB-02 | `draft_reply` creates `pending_approval` items only. `adapter.send` is called exclusively by `outbox.approve(itemId)` from the UI. | M |
| FR-OB-03 | The user may edit `to`, `subject`, `body` while pending; edits are validated (Gmail: RFC 5322 addresses; Facebook: body ≤ 2 000 chars, `to` fixed). | M |
| FR-OB-04 | Send cap: max **20** approved sends per account per rolling 60 min; the 21st returns `OUTBOX_SEND_CAP` with the time when the next send is possible. | M |
| FR-OB-05 | "Approve all" is disabled for external channels (UI and RPC: `outbox.approve` takes exactly one id). | M |
| FR-OB-06 | Items with `sendBefore` in the past become `expired` on read/approve (no timers); approving an expired item returns `MESSAGING_WINDOW_EXPIRED` with remediation. | M |
| FR-OB-07 | Send failures set `failed` with `AppError`; the user can *Retry* (back to pending) or *Discard*. Duplicate-send protection: an item is marked `sending` in memory; a second approve while sending returns `CONFLICT`. | M |
| FR-CH-07 | Inbox tab: account selector + *Sync* button, Inbound pane (triage chips, summary, from, received, *Process*, *Triage selected*), Outbox pane (pending first; edit, approve & send, reject; status chips; countdown for `sendBefore`), badge counts on the nav item. | M |
| FR-CH-08 | VS Code protocol v2 (DD-V2-08) adds chat messages (§6.4). The extension shows a webview chat panel (command "IT Studio: Open Chat"): agent picker, input, streamed replies, *Send selection*, *Send current file* (≤ 200 KB), *Start pipeline from this* (creates the same confirmation as FR-AG-09, confirmed in the panel). | M |
| FR-CH-09 | VS Code chat runs use `trigger = vscode`, the project of the connected workspace, and the same conversation storage (conversation title prefixed "VS Code: "). | M |
| FR-CH-10 | Webview security: CSP `default-src 'none'; script-src 'nonce-…'; style-src ${webview.cspSource}`; messages validated with zod on both sides; replies rendered as sanitized markdown (no raw HTML). | M |

### 3.4 Gmail (M13) — `FR-GM`
| ID | Requirement | Pri |
|---|---|---|
| FR-GM-01 | Connect: user enters OAuth client id (+ secret if Google issued one) → sidecar starts loopback listener on `127.0.0.1:<random>` → returns auth URL (PKCE S256, `state` 32 bytes) → UI opens it → callback validates `state`, exchanges code, stores refresh token in keychain `itstudio-channel/<accountId>`, reads profile email → `ChannelAccount`. Listener closes after success or 5 min. | M |
| FR-GM-02 | Scopes exactly `gmail.modify` and `gmail.send`. Disconnect revokes the token (best effort) and deletes keychain entries. | M |
| FR-GM-03 | Sync: `users.history.list(startHistoryId)`; on 404 (history expired) or first sync: `messages.list q="newer_than:7d in:inbox"` (max 200). Fetch `format=full`, parse MIME (`mailparser`), prefer `text/plain`, else HTML→text; attachments → names only. | M |
| FR-GM-04 | HTTP 401 → one token refresh then `CHANNEL_AUTH` with remediation "Reconnect Gmail"; 429/5xx → exponential backoff (max 3 tries, honours `Retry-After`). | M |
| FR-GM-05 | Send: compose RFC 5322 (UTF-8, `Subject` encoded-word, `In-Reply-To`, `References`, `threadId`), base64url, `users.messages.send`. | M |
| FR-GM-06 | After the user confirms triage, apply labels `ITStudio/Urgent`, `ITStudio/Action`, `ITStudio/FYI` (created if missing; ids cached per account). Spam/command → no label. | S |
| FR-GM-07 | Email commands (D23): command iff sender ∈ `commandSenders` (default: account address) **and** subject starts with `[ITS]` **and** `Authentication-Results` has `dkim=pass` for the sender domain. Any failed condition → normal message (not command), with a visible reason chip. | M |
| FR-GM-08 | A command is shown in the Inbox as *Command* with the parsed request; *Run* (in-app confirmation) starts an agent run (`channel_action`, but tools = owner's agent tools minus `start_pipeline` unless the user ticks "allow pipeline" in the confirmation); the result is drafted as a reply to the Outbox. | M |
| FR-GM-09 | "Email me this report" on the P&L view and on a pipeline failure report creates an Outbox item to the account's own address with a plain-text report (no LLM). | S |

### 3.5 Facebook Page (M14) — `FR-FB`
| ID | Requirement | Pri |
|---|---|---|
| FR-FB-01 | Connect: user pastes Page id + long-lived Page access token; sidecar validates by `GET /{page-id}?fields=id,name` and `GET /{page-id}/conversations?limit=1`; token stored in keychain; `ChannelAccount.displayName` = Page name. | M |
| FR-FB-02 | Sync conversations updated since `lastSyncedAt` (`/{page-id}/conversations?fields=updated_time,messages.limit(20){message,from,created_time}`), store customer messages only (not Page-authored). | M |
| FR-FB-03 | Drafts in reply get `sendBefore = lastCustomerMessageAt + 24 h`; send uses `messaging_type: RESPONSE`. | M |
| FR-FB-04 | Window rule: send allowed iff `now < sendBefore` (strict); boundary tests at −1 s / 0 / +1 s. | M |
| FR-FB-05 | Rate limits: parse `x-business-use-case-usage` / `x-app-usage`; when any value ≥ 90 % or HTTP 429/code 613/80006 → back off (`estimated_time_to_regain_access` minutes if present, else 60 s) and return `CHANNEL_RATE_LIMITED` with retry time. | M |
| FR-FB-06 | Errors 190 (expired/invalid token) → `CHANNEL_AUTH` "Generate a new Page token" remediation; 10/200 (permission) → `CHANNEL_AUTH` listing the required permissions. | M |

### 3.6 Workflow map coverage — `FR-WF2`
| ID | Requirement | Pri |
|---|---|---|
| FR-WF2-01 | New modules (additive `WorkflowModuleId`): `agent_runner`, `memory`, `channels`, `triage`, `outbox`; edges: Chat→AgentRunner (`AgentRequest`), AgentRunner→Router (`LlmRequest`), AgentRunner→Memory (`MemoryRecallHit[]`), Channels→Triage (`ChannelMessage[]`), Channels→AgentRunner (`AgentRequest`), AgentRunner→Outbox (`OutboxItem`), Outbox→Channels (`send`). | S |
| FR-WF2-02 | Activity summaries for these modules contain counts, agent names, statuses and costs only — never message bodies, email addresses or memory text. | M |

---

## 4. Non-functional requirements — `NFR-V2`

| ID | Category | Requirement | Verification |
|---|---|---|---|
| NFR-V2-01 | Cost | No LLM call, embedding or channel API call happens without a user action (D21). | L3: run the app 10 min idle with accounts connected → 0 ledger rows, 0 HTTP calls to fakes |
| NFR-V2-02 | Cost | Triage of 20 messages ≤ 1 LLM call; memory extraction ≤ 1 LLM call per conversation close. | L2 call counters |
| NFR-V2-03 | Security | Tokens/keys never appear in RPC results, logs, DB, activity events (secret scan over logs + DB dump in QA). | L3 + scan |
| NFR-V2-04 | Security | Prompt-injection corpus (≥ 15 cases) in emails/Messenger never leads to: a send without approval, a non-allowed tool executing, a memory being written, a pipeline starting. | L3 corpus |
| NFR-V2-05 | Reliability | Sidecar crash during send: the item is never sent twice (status persisted as `failed` with "unknown — check Sent folder" on restart if crash happened after request start). | L3 crash hook |
| NFR-V2-06 | Performance | Agent turn overhead (context build + memory recall, excluding the model) p95 ≤ 300 ms with 5 000 memories; Inbox renders 1 000 messages with virtualisation ≤ 200 ms. | L2 bench, L4 |
| NFR-V2-07 | Privacy | Export and *Forget everything* complete in ≤ 5 s for 10 000 memories; deletion removes vectors and rows. | L3 |
| NFR-V2-08 | Usability | All new UI in en + vi; keyboard-only operable; WCAG AA via theme tokens. | L2 a11y + L4 |
| NFR-V2-09 | Maintainability | Coverage gates per TESTING §4; 100 % branch for `agent-tool-policy`, `outbox-machine`, `email-command-policy`, `messaging-window`, `memory-filter`. | coverage report |
| NFR-V2-10 | Compatibility | v1 data upgrades in place (migrations forward-only); v1 extension (protocol 1) still connects. | L3 upgrade test from a v1 DB fixture |

---

## 5. Data requirements (SQLite, Drizzle; migrations generated by the Architect)

| Table | Columns (type) | Keys / indexes | Milestone |
|---|---|---|---|
| `agents` | `id` text PK, `body` text (JSON `AgentDefinition`), `built_in` int, `enabled` int, `name_lower` text, `created_at`, `updated_at` | unique `name_lower` | M10 |
| `agent_runs` | `id` PK, `agent_id`, `project_id`, `conversation_id` null, `trigger_kind`, `channel_message_id` null, `status`, `body` JSON (tool calls, recalled ids, outbox ids, error), `cost_micro_usd` int, `started_at`, `finished_at` null | idx `(project_id, started_at)`, idx `(agent_id, started_at)`, idx `conversation_id` | M10 |
| `routing_rules` | `id` PK, `ord` int, `channel`, `match` JSON, `agent_id`, `enabled` | unique `ord` | M10 |
| `project_agent_defaults` | `project_id` PK, `agent_id` null | — | M10 |
| `conversations` (alter) | + `agent_id` null, + `pending_extraction` int default 0, + `extracted_until_message_id` null | — | M10/M11 |
| `memories` | `id` PK, `agent_id`, `project_id` null, `kind`, `text`, `importance` int, `pinned` int, `source` JSON, `embedding_model`, `created_at`, `updated_at`, `last_recalled_at` null, `expires_at` null | idx `(agent_id, project_id)` | M11 |
| `channel_accounts` | `id` PK, `kind`, `display_name`, `project_id`, `default_agent_id` null, `command_senders` JSON, `cursor` text null (Gmail historyId / FB last updated_time), `last_synced_at` null, `connected` int | — | M12 |
| `channel_messages` | `id` PK, `account_id`, `kind`, `external_thread_id`, `external_message_id`, `from` JSON, `subject` null, `text`, `received_at`, `triage`, `summary` null, `handled_by_run_id` null, `meta` JSON (labels applied, command check results) | unique `(account_id, external_message_id)`, idx `(account_id, received_at)` | M12 |
| `outbox_items` | `id` PK, `account_id`, `kind`, `run_id` null, `in_reply_to` null, `to` JSON, `subject` null, `body`, `status`, `send_before` null, `created_at`, `decided_at` null, `error` JSON null, `external_message_id` null | idx `(account_id, status)` | M12 |
| `outbox_sends` | `account_id`, `sent_at` | idx `(account_id, sent_at)` (rolling cap) | M12 |

LanceDB: `memories_<agentId>` — columns `id` (utf8), `vector` (fixed-size list float32, dimension from settings), explicit Arrow schema (BUG-M5-001 lesson).

Keychain entries: `itstudio-channel/<accountId>` (Gmail refresh token JSON `{refreshToken, clientId, clientSecret?}`; Facebook Page token).

---

## 6. External interface requirements (exact contracts — added to `schemas.ts` by the Architect in Mx-00 tasks)

### 6.1 Additive changes to existing types
```ts
// §1 ErrorCode — new members
TOOL_NOT_ALLOWED, CHANNEL_AUTH, CHANNEL_RATE_LIMITED, OUTBOX_SEND_CAP, MESSAGING_WINDOW_EXPIRED
// §4 ToolName — new members
RECALL_MEMORY: 'recall_memory', REMEMBER: 'remember', DRAFT_REPLY: 'draft_reply', START_PIPELINE: 'start_pipeline'
// §6 CostPurpose — new members
AGENT: 'agent', MEMORY_EXTRACTION: 'memory_extraction', TRIAGE: 'triage'
// §4 Conversation — new optional fields
readonly agentId?: AgentId; readonly pendingExtraction?: boolean;
// §6 LedgerEntry — new optional field
readonly agentRunId?: AgentRunId;
// §12b WorkflowModuleId — new members (FR-WF2-01)
AGENT_RUNNER: 'agent_runner', MEMORY: 'memory', CHANNELS: 'channels', TRIAGE: 'triage', OUTBOX: 'outbox'
// §12b ActivityEvent.refs — new optional fields
agentRunId?, memoryId?, channelMessageId?, outboxItemId?
// §14 AgentRun — new optional fields (status union unchanged)
readonly conversationId?: ConversationId; readonly pendingPipelinePrompt?: string; readonly pipelineRunId?: PipelineRunId;
// §16 OutboxStatus — unchanged ("sending" is an in-memory flag, never persisted)
// §16 OutboxItem — new optional field
readonly externalMessageId?: string;
```

### 6.2 New argument types
```ts
export interface RecallMemoryArgs { readonly query: string; readonly topK?: number }            // 1..20
export interface RememberArgs { readonly text: string; readonly kind?: MemoryKind; readonly importance?: 1|2|3|4|5 }
export interface DraftReplyArgs { readonly inReplyTo: ChannelMessageId; readonly body: string; readonly subject?: string }
export interface StartPipelineArgs { readonly prompt: string }                                 // ≤ 8 000 chars
export interface AgentInput { readonly agentId: AgentId; readonly projectId: ProjectId; readonly conversationId: ConversationId; readonly text: string }
export interface TriageResult { readonly id: ChannelMessageId; readonly triage: InboundTriage; readonly summary: string }
export interface CommandCheck { readonly senderAllowed: boolean; readonly prefixOk: boolean; readonly dkimPass: boolean; readonly isCommand: boolean }
```

### 6.3 RPC methods (`RpcMethodMap`, additive)
```ts
// M10
'agents.list': { params: Empty; result: readonly AgentDefinition[] };
'agents.get': { params: { agentId: AgentId }; result: AgentDefinition };
'agents.create': { params: { agent: Omit<AgentDefinition,'id'|'builtIn'|'createdAt'|'updatedAt'> }; result: AgentDefinition };
'agents.update': { params: { agentId: AgentId; patch: Partial<Omit<AgentDefinition,'id'|'builtIn'|'template'|'createdAt'|'updatedAt'>> }; result: AgentDefinition };
'agents.clone': { params: { agentId: AgentId }; result: AgentDefinition };
'agents.delete': { params: { agentId: AgentId }; result: { deleted: boolean } };
'agents.getProjectDefault': { params: { projectId: ProjectId }; result: { agentId: AgentId | null } };
'agents.setProjectDefault': { params: { projectId: ProjectId; agentId: AgentId | null }; result: { agentId: AgentId | null } };
'agents.listRuns': { params: { agentId?: AgentId; conversationId?: ConversationId; projectId?: ProjectId; limit: number; before?: IsoDateTime }; result: readonly AgentRun[] };
'agents.cancelRun': { params: { runId: AgentRunId }; result: AgentRun };
'agents.confirmPipeline': { params: { runId: AgentRunId; prompt: string }; result: PipelineRun };
'agents.dismissPipeline': { params: { runId: AgentRunId }; result: AgentRun };
'chat.setAgent': { params: { conversationId: ConversationId; agentId: AgentId | null }; result: Conversation };
'routing.list': { params: Empty; result: readonly RoutingRule[] };
'routing.save': { params: { rules: readonly Omit<RoutingRule,'id'>[] | readonly RoutingRule[] }; result: readonly RoutingRule[] }; // replaces the whole ordered list
'routing.test': { params: { channel: ChannelKind; from?: string; subject?: string; text?: string }; result: { ruleId: RoutingRuleId | null; agentId: AgentId | null } };
// M11
'chat.closeConversation': { params: { conversationId: ConversationId }; result: { extractionStarted: boolean } };
'memory.list': { params: { agentId?: AgentId; projectId?: ProjectId | null; kinds?: readonly MemoryKind[]; text?: string; limit: number; cursor?: string }; result: Page<MemoryItem> };
'memory.search': { params: { agentId: AgentId; projectId: ProjectId | null; query: string; topK: number }; result: readonly MemoryRecallHit[] };
'memory.create': { params: { agentId: AgentId; projectId: ProjectId | null; kind: MemoryKind; text: string; importance: 1|2|3|4|5 }; result: MemoryItem };
'memory.update': { params: { memoryId: MemoryId; patch: { text?: string; kind?: MemoryKind; importance?: 1|2|3|4|5; expiresAt?: IsoDateTime | null } }; result: MemoryItem };
'memory.setPinned': { params: { memoryId: MemoryId; pinned: boolean }; result: MemoryItem };
'memory.delete': { params: { memoryId: MemoryId }; result: { deleted: boolean } };
'memory.forgetAll': { params: { agentId: AgentId; confirmName: string }; result: { deleted: number } };
'memory.export': { params: { agentId?: AgentId }; result: { json: string; count: number } };
'memory.cleanup': { params: Empty; result: { purgedExpired: number; reembedded: number; repaired: number } };
'memory.extractNow': { params: { conversationId: ConversationId }; result: { created: number; updated: number; rejected: number } };
'memory.rememberMessage': { params: { messageId: MessageId }; result: MemoryItem };
// M12
'channels.listAccounts': { params: Empty; result: readonly ChannelAccount[] };
'channels.updateAccount': { params: { accountId: ChannelAccountId; patch: { projectId?: ProjectId; defaultAgentId?: AgentId | null; commandSenders?: readonly string[] } }; result: ChannelAccount };
'channels.disconnect': { params: { accountId: ChannelAccountId }; result: ChannelAccount };
'channels.sync': { params: { accountId: ChannelAccountId }; result: { newCount: number; lastSyncedAt: IsoDateTime } };
'channels.listMessages': { params: { accountId: ChannelAccountId; triage?: readonly InboundTriage[]; limit: number; cursor?: string }; result: Page<ChannelMessage> };
'channels.triage': { params: { accountId: ChannelAccountId; messageIds?: readonly ChannelMessageId[] }; result: readonly TriageResult[] };   // proposal, not yet applied
'channels.applyTriage': { params: { results: readonly TriageResult[] }; result: { applied: number } };
'channels.process': { params: { messageId: ChannelMessageId; agentId?: AgentId }; result: AgentRun };
'outbox.list': { params: { accountId?: ChannelAccountId; statuses?: readonly OutboxStatus[]; limit: number; cursor?: string }; result: Page<OutboxItem> };
'outbox.update': { params: { itemId: OutboxItemId; patch: { to?: readonly string[]; subject?: string; body?: string } }; result: OutboxItem };
'outbox.approve': { params: { itemId: OutboxItemId }; result: OutboxItem };
'outbox.reject': { params: { itemId: OutboxItemId }; result: OutboxItem };
'outbox.retry': { params: { itemId: OutboxItemId }; result: OutboxItem };
'outbox.counts': { params: Empty; result: { pendingApproval: number; untriaged: number } };
// M13
'gmail.beginConnect': { params: { projectId: ProjectId; clientId: string; clientSecret?: string }; result: { authUrl: string; flowId: string; expiresAt: IsoDateTime } };
'gmail.connectStatus': { params: { flowId: string }; result: { state: 'waiting' | 'connected' | 'failed' | 'expired'; account?: ChannelAccount; error?: AppError } };
'gmail.runCommand': { params: { messageId: ChannelMessageId; allowPipeline: boolean; agentId?: AgentId }; result: AgentRun };
'reports.emailPnl': { params: { accountId: ChannelAccountId; projectId: ProjectId | null; from: IsoDateTime; to: IsoDateTime }; result: OutboxItem };
'reports.emailFailure': { params: { accountId: ChannelAccountId; runId: PipelineRunId }; result: OutboxItem };
// M14
'facebook.connect': { params: { projectId: ProjectId; pageId: string; pageToken: string }; result: ChannelAccount };
```
All params/results are `readonly` in the real file (omitted above for brevity). Every method gets a zod validator in `apps/sidecar/src/validation/` (equality test, ARCH §1 principle 2).

### 6.4 Notifications (`RpcNotificationMap`, additive)
```ts
'agent.run': AgentRun;                                       // status changes
'agent.delta': { runId: AgentRunId; requestId: LlmRequestId; textDelta: string };
'memory.changed': { agentId: AgentId; created: number; updated: number; deleted: number };
'channels.synced': { accountId: ChannelAccountId; newCount: number; lastSyncedAt: IsoDateTime };
'outbox.changed': OutboxItem;
'gmail.connect': { flowId: string; state: 'connected' | 'failed' | 'expired' };
```
Chat UI keeps using `chat.delta/completed/failed` for agent-bound conversations (the `requestId` is the run's current router request); `agent.delta` is used by the VS Code panel and Inbox runs.

### 6.5 VS Code protocol v2 (§11 additive)
```ts
ExtHello.protocolVersion: 1 | 2
ExtToSidecar += { type: 'chat_send'; ref: number; agentId: AgentId | null; conversationId: ConversationId | null; text: string; attachments: readonly { kind: 'selection' | 'file'; path: WorkspaceRelativePath; text: string }[] }
             |  { type: 'chat_list_agents'; ref: number }
             |  { type: 'chat_confirm_pipeline'; ref: number; runId: AgentRunId; prompt: string }
SidecarToExt += { type: 'chat_agents'; ref: number; agents: readonly { id: AgentId; name: string }[] }
             |  { type: 'chat_started'; ref: number; runId: AgentRunId; conversationId: ConversationId }
             |  { type: 'chat_delta'; runId: AgentRunId; textDelta: string }
             |  { type: 'chat_done'; runId: AgentRunId; text: string; cost: MoneyDisplay; pipelineConfirmation?: { prompt: string } }
             |  { type: 'chat_error'; runId: AgentRunId | null; ref: number; error: AppError }
```

### 6.6 External services
| Service | Endpoints | Auth | Limits handled |
|---|---|---|---|
| Google OAuth 2.0 | `accounts.google.com/o/oauth2/v2/auth`, `oauth2.googleapis.com/token`, `/revoke` | PKCE S256 + loopback | 5 min flow timeout |
| Gmail API v1 | `users.getProfile`, `history.list`, `messages.list/get/send`, `labels.list/create`, `messages.modify` | Bearer (refresh on 401) | 429/5xx backoff; quota units logged |
| Meta Graph API (pinned version `v21.0`, configurable in `config/channels.json`) | `/{page-id}`, `/{page-id}/conversations`, `/{page-id}/messages` | Page token | BUC usage headers, codes 4/17/32/613/80006 |

---

## 7. Behavioural models

### 7.1 AgentRun state machine
```
RUNNING ──(text answer, no pending confirmation)──► COMPLETED
RUNNING ──(start_pipeline proposed)──► AWAITING_APPROVAL ──confirm──► COMPLETED (pipelineRunId recorded)
                                                     └──dismiss──► COMPLETED
RUNNING ──(error after fallback / budget hard stop)──► FAILED
RUNNING | AWAITING_APPROVAL ──cancel──► CANCELLED
```
Terminal: COMPLETED, FAILED, CANCELLED. Illegal transitions throw in dev, `CONFLICT` at RPC.

### 7.2 Outbox state machine (`domain/outbox-machine.ts`, 100 % branch)
| From \ event | edit | approve (ok) | approve (send error) | approve (expired) | approve (cap reached) | reject | retry | discard |
|---|---|---|---|---|---|---|---|---|
| pending_approval | pending_approval | sent | failed | expired | pending_approval + `OUTBOX_SEND_CAP` | rejected | ✗ | ✗ |
| failed | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | pending_approval | rejected |
| sent / rejected / expired | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

### 7.3 Email command decision table (`domain/email-command-policy.ts`)
| R | sender allow-listed | subject `[ITS]` | DKIM pass | Result |
|---|---|---|---|---|
| 1 | Y | Y | Y | **command** |
| 2 | Y | Y | N | normal, chip "DKIM failed" |
| 3 | Y | N | – | normal |
| 4 | N | Y | – | normal, chip "sender not allowed" |
| 5 | N | N | – | normal |

### 7.4 Tool policy (`domain/agent-tool-policy.ts`, 100 % branch)
| Tool \ trigger | ui | vscode | channel_action (external) |
|---|---|---|---|
| search_knowledge | ✔ | ✔ | ✔ |
| recall_memory | ✔ | ✔ | ✔ |
| remember | ✔ | ✔ | ✗ |
| draft_reply | ✔ (only with a channel message in context) | ✗ | ✔ |
| start_pipeline | ✔ (confirmation) | ✔ (confirmation) | ✗ |
| generate_image | ✔ if `settings.image.enabled` | ✔ if enabled | ✗ |

---

## 8. Error codes & remediation (added to `domain/remediation.ts`)
| Code | Message (en) | Remediation |
|---|---|---|
| `TOOL_NOT_ALLOWED` | "This agent tried to use a tool that is not allowed here." | "Check the agent's tools in Settings → Agents." / "External messages can only search, recall and draft." |
| `CHANNEL_AUTH` | "The channel connection is no longer authorised." | "Open Inbox → Accounts and reconnect." |
| `CHANNEL_RATE_LIMITED` | "The channel provider is rate-limiting requests." | "Try again after <time>." |
| `OUTBOX_SEND_CAP` | "Send limit reached (20 per hour for this account)." | "Wait until <time> or send from the provider's own app." |
| `MESSAGING_WINDOW_EXPIRED` | "Facebook only allows replies within 24 hours of the customer's last message." | "Ask the customer to message the Page again, or reply from Meta Business Suite with a message tag if eligible." |

---

## 9. Traceability (decision → requirement → milestone task → test)
| Decision | Requirements | Tasks | QA doc |
|---|---|---|---|
| D18 | FR-AG-01…16 | M10-01…M10-09 | M10-test-cases |
| D19 | FR-MEM-01…11 | M11-01…M11-07 | M11-test-cases |
| D20 | FR-CH-01…10, FR-GM-*, FR-FB-* | M12-*, M13-*, M14-* | M12/M13/M14-test-cases |
| D21 | NFR-V2-01, FR-CH-02, DD-V2-02/03 | M10-04, M11-03, M12-02 | all v2 QA docs (idle-traffic case) |
| D22 | FR-OB-01…07, FR-AG-08 | M12-03, M12-04 | M12-test-cases |
| D23 | FR-GM-07/08 | M13-05 | M13-test-cases |
| D32 | FR-WF2-01/02 | M10-09, M12-08 | M10/M12-test-cases |

## 10. Acceptance (release v2.0.0)
All M10–M14 exit criteria (ROADMAP) demonstrated; all `M` requirements pass; NFR-V2-01/03/04 pass with evidence in `docs/qa/M12-report.md`; installers rebuilt and install smoke green (M14-05).

## 11. Open questions (ask the owner before the milestone that needs them)
| ID | Question | Needed by | Default if unanswered |
|---|---|---|---|
| Q-06 | Which Gmail account and which project should it belong to? | M13 live QA | One account, active project |
| Q-07 | Facebook Page to connect (and whether the Meta app stays in development mode). | M14 live QA | Development-mode app, owner is Page admin |
| Q-08 | Should Email reports include an "overnight summary" (pipeline runs + spend of the last 24 h)? | M13-06 | Yes, plain text, no LLM |
