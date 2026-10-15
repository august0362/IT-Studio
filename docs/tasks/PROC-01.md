# PROC-01 — Process registry (sidecar): every activity becomes a tracked process with a module pipeline

Milestone: PROC (CONTEXT D40) · **After OWNER-FB2-A lands** · Role: Implementer · Size L · **Deps pre-installed** · **Broad scope inside `apps/sidecar/**`: do not stop for edits needed to meet a requirement — list them in Result**

## Goal

The owner sees every real activity as a **process**: 🟢 running · 🟡 waiting (queued or waiting for the user) · 🔴 stopped part-way (failed / cancelled / interrupted — can be retried) · ⚪ ended for good (completed or dismissed; only the newest 20 kept). Each process has a **module pipeline** (nodes + edges) with per-module status and short input/output summaries, so the desktop (PROC-02) can draw it like Pipeline Studio and show data moving to the final result.

## Contracts (`src/types/schemas.ts`, additive, new section `/* §PROCESSES (D40) */`, plus `validation/ipc.ts` entries)

```ts
export type ProcessId = Brand<string, 'ProcessId'>;
export const ProcessKind = {
  CHAT: 'chat', CODE_PIPELINE: 'code_pipeline', KNOWLEDGE_INGEST: 'knowledge_ingest', IMAGE: 'image',
  PRICE_UPDATE: 'price_update', KEY_VERIFY: 'key_verify', VSCODE_LAUNCH: 'vscode_launch', WEB_CHAT: 'web_chat',
} as const;
export type ProcessKind = (typeof ProcessKind)[keyof typeof ProcessKind];
export const ProcessStatus = { RUNNING: 'running', WAITING: 'waiting', STOPPED: 'stopped', ENDED: 'ended' } as const;
export type ProcessStatus = (typeof ProcessStatus)[keyof typeof ProcessStatus];
export const ProcessModuleState = { IDLE: 'idle', ACTIVE: 'active', WAITING: 'waiting', DONE: 'done', FAILED: 'failed', SKIPPED: 'skipped' } as const;
export type ProcessModuleState = (typeof ProcessModuleState)[keyof typeof ProcessModuleState];

export interface ProcessModule {
  readonly id: string;                 // stable per kind, e.g. 'router'
  readonly label: string;              // English; UI translates by `${kind}.${id}` key when available
  readonly state: ProcessModuleState;
  readonly startedAt?: IsoDateTime;
  readonly endedAt?: IsoDateTime;
  readonly input?: string;             // ≤ 500 chars, redacted summary (never secrets)
  readonly output?: string;            // ≤ 500 chars, redacted summary
  readonly detail?: JsonObject;        // small structured facts: model, tokens, cost text, file count…
}
export interface ProcessEdge { readonly from: string; readonly to: string; readonly label?: string }
export interface ProcessRecord {
  readonly id: ProcessId;
  readonly kind: ProcessKind;
  readonly projectId?: ProjectId;
  readonly title: string;              // ≤ 120 chars, e.g. 'Chat: "Làm app ghi chú…"' (first 60 chars of the user text)
  readonly status: ProcessStatus;
  readonly statusReason?: string;      // e.g. 'Waiting for your answers', 'LADDER_EXHAUSTED: …'
  readonly modules: readonly ProcessModule[];
  readonly edges: readonly ProcessEdge[];
  readonly result?: string;            // ≤ 500 chars final output summary
  readonly costText?: string;          // existing money display text when known
  readonly ref?: { readonly type: 'conversation' | 'pipeline_run' | 'ingest_job' | 'image' | 'price_run' | 'webchat_link'; readonly id: string };
  readonly retryable: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly endedAt?: IsoDateTime;
}
export type ProcessEvent =
  | { readonly type: 'upsert'; readonly process: ProcessRecord }
  | { readonly type: 'removed'; readonly id: ProcessId };

// RPC
'process.list': { params: { readonly projectId?: ProjectId; readonly status?: readonly ProcessStatus[]; readonly kind?: readonly ProcessKind[]; readonly limit: number }; result: readonly ProcessRecord[] };
'process.get': { params: { readonly id: ProcessId }; result: ProcessRecord };
'process.cancel': { params: { readonly id: ProcessId }; result: ProcessRecord };     // running/waiting → stopped (delegates to the owning service's cancel)
'process.retry': { params: { readonly id: ProcessId }; result: ProcessRecord };      // stopped & retryable → new process
'process.dismiss': { params: { readonly id: ProcessId }; result: ProcessRecord };    // stopped → ended
'process.delete': { params: { readonly id: ProcessId }; result: { readonly deleted: boolean } }; // ended only
'process.report': { params: { readonly kind: 'web_chat'; readonly linkId: string; readonly event: 'opened' | 'loaded' | 'closed' | 'failed'; readonly projectId?: ProjectId }; result: ProcessRecord }; // desktop reports web-chat pane lifecycle (D34: no page content)
// notification
'process.event': ProcessEvent;
```

## Module graphs per kind (binding ids, in order; edges are the chain unless noted)

| Kind | Modules | Notes |
|---|---|---|
| `chat` | `input` → `context` (knowledge/memory injection, skipped when off) → `router` (chosen model / fallbacks in `detail`) → `provider` → `stream` → `cost` → `output` | Fallback attempts listed in `router.detail.attempts`. Fallback decision prompt → process `waiting`. |
| `code_pipeline` | `request` → `clarify` → `spec` → `code` → `review` → `fix` → `re_review` → `write` → `validate` → `done`; extra edges `review→write`, `re_review→write`, `review→fix` | Mirror the PipelineRun stages (same mapping as Pipeline Studio); `clarifying` → `waiting`. |
| `knowledge_ingest` | `discover` → `parse` → `chunk` → `embed` → `store` → `done` | Counts in `detail` (files, chunks, skipped, failed). |
| `image` | `prompt` → `budget` → `provider` → `download` → `store` → `gallery` | |
| `price_update` | `sources` → `fetch` → `extract` → `validate` → `save` | Per-provider outcomes in `detail`. |
| `key_verify` | `input` → `request` → `result` | Never include the key; masked last 4 only. |
| `vscode_launch` | `locate` → `launch` → `session` | |
| `web_chat` | `open` → `load` → `active` → `closed` | From `process.report`; `closed` → ended, `failed` → stopped. |

Not processes: settings/list/get/ping/CRUD calls.

## Requirements

1. **Service** `process-registry` (in-memory + SQLite table `processes` with a JSON column for modules/edges, Drizzle migration): `start(kind, init)`, `module(id, moduleId, patch)`, `status(id, status, reason?)`, `end(id, result?)`; every change publishes `process.event` (coalesced ≤ 10/s per process) and persists (batched ≤ 1 s).
2. **Instrument** the owning services at their existing lifecycle points (chat-service, pipeline-orchestrator, rag ingest, image-service, pricing-updater, secrets verify, vscode-launcher) via an injected `IProcessTracker` port (no-op default so unit tests of those services stay unchanged).
3. **Status rules:** running = any module active; waiting = queued (e.g. project pipeline queue) or awaiting the user; stopped = failed / cancelled / interrupted by restart; ended = completed or dismissed. On startup every persisted `running`/`waiting` process that is not a `clarifying` pipeline becomes `stopped` with reason "Interrupted by restart".
4. **Retention:** keep all running/waiting/stopped; keep only the newest **20 ended** processes (delete older ones on every transition to ended).
5. **Retry** re-invokes the original operation with its stored safe parameters (chat: resend the same user message in the same conversation; pipeline: same prompt; ingest: same paths; image: same prompt; price update: same selection; key verify: re-verify stored key). Not retryable kinds return `VALIDATION`.
6. **Privacy:** summaries pass through the existing redaction; no API keys, no full file contents, no web-chat page content.

## Tests (lean)

Unit: registry transitions, coalescing, retention 20, restart sweep, retry dispatch per kind, redaction; one instrumentation test per kind with fakes. Integration: `TC-PROC-001` chat send produces a chat process that ends with modules done and a cost; `TC-PROC-002` failing chat → stopped → retry creates a new process; `TC-PROC-003` restart turns running into stopped.

## Acceptance criteria

- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass. QA runs the new integration cases + `chat`, `pipeline`, `rag-ingest`.

## Hand-back

Append `## Result` per AGENTS.md §3.
