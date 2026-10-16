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

## Result
- Summary: Implemented persisted process tracking for all eight activity kinds, with the binding module graphs, lifecycle summaries and details, formatted costs where available, typed RPC/actions and notifications, cancellation, safe retry dispatch, restart interruption recovery and global retention of the newest 20 ended processes. Added lean registry/persistence tests, one instrumentation check per kind, composed chat checks, and TC-PROC-001/002/003 integration cases.
- Files changed: `apps/sidecar/src/container.ts`; `apps/sidecar/src/infra/http/provider-key-verifier.ts`; `apps/sidecar/src/infra/sqlite/migrations/meta/_journal.json`; `apps/sidecar/src/infra/sqlite/schema.ts`; `apps/sidecar/src/rpc/rpc-server.ts`; `apps/sidecar/src/services/chat-service.test.ts`; `apps/sidecar/src/services/chat-service.ts`; `apps/sidecar/src/services/image-service.test.ts`; `apps/sidecar/src/services/image-service.ts`; `apps/sidecar/src/services/pipeline-orchestrator.test.ts`; `apps/sidecar/src/services/pipeline-orchestrator.ts`; `apps/sidecar/src/services/pricing-updater.test.ts`; `apps/sidecar/src/services/pricing-updater.ts`; `apps/sidecar/src/services/rag/rag-service.test.ts`; `apps/sidecar/src/services/rag/rag-service.ts`; `apps/sidecar/src/services/secrets-service.test.ts`; `apps/sidecar/src/services/secrets-service.ts`; `apps/sidecar/src/services/vscode-launcher.test.ts`; `apps/sidecar/src/services/vscode-launcher.ts`; `apps/sidecar/src/validation/brand.ts`; `apps/sidecar/src/validation/ipc.ts`; `src/types/schemas.ts`; `apps/sidecar/src/domain/process-graphs.ts`; `apps/sidecar/src/infra/sqlite/migrations/0013_processes.sql`; `apps/sidecar/src/infra/sqlite/migrations/meta/0013_snapshot.json`; `apps/sidecar/src/infra/sqlite/process-repository.test.ts`; `apps/sidecar/src/infra/sqlite/process-repository.ts`; `apps/sidecar/src/ports/process-tracker.ts`; `apps/sidecar/src/services/process-activity.ts`; `apps/sidecar/src/services/process-container.test.ts`; `apps/sidecar/src/services/process-registry.test.ts`; `apps/sidecar/src/services/process-registry.ts`; `apps/sidecar/src/services/process-test-helper.ts`; `apps/sidecar/src/validation/process-operation.ts`; `apps/sidecar/src/validation/process.ts`; `apps/sidecar/test/integration/processes.test.ts`; this task file (append-only Result).
- Dependencies added (with reason): None. Ran `npm.cmd --cache .npm-cache install` because node_modules was absent; package manifests and lockfile are unchanged. Used npm.cmd because PowerShell blocks npm.ps1 under the current execution policy.
- Decisions taken within scope: Services receive an optional IProcessTracker with a no-op default. Process snapshots persist in batches every 500 ms; upserts/removals coalesce on a 100 ms window per process. Private, runtime-validated replay parameters are separate from public process records, and every replay string passes through the existing secret redactor before persistence; a prompt containing a recognized secret is retried with its redacted replacement. Key replay stores only the provider ID and rereads the current key from the secret store. Persisted sequence values break timestamp ties for ordering/retention. Recovery sweeps only records loaded at startup, preserving clarifying pipelines as waiting. Added an optional AbortSignal to the provider key verifier so process cancellation cannot save a candidate key after abort. Added Drizzle migration 0013_processes and its snapshot/journal metadata without changing existing migrations.
- Validation: Ran Prettier on all changed supported files (the repository intentionally ignores canonical schemas, Markdown and migration metadata). `npm.cmd --cache .npm-cache run typecheck` passed. `npm.cmd --cache .npm-cache run lint` passed (Git emits the sandbox permission warning below). Direct full Vitest run passed: 164 test files passed, one skipped; 1,505 tests passed, one skipped. The 26 release/build/dev Node script tests passed. `git diff --check` passed. No commits or pushes were made.
- Open issues / follow-ups: `npm.cmd --cache .npm-cache test` stops in the existing lint:selftest secret-scanner regression tests because Git emits `unable to access C:/Users/admin/.config/git/ignore: Permission denied` on stderr, while those tests require empty stderr. Ran its Vitest and Node script-test portions directly as reported above. The requested integration run (processes, chat, pipeline and rag-ingest, plus web-chat matched by the chat filter) cannot start any sidecar: tsx fails in os.userInfo() with uv_os_get_passwd ENOMEM, a documented AGENTS.md sandbox limit. Drizzle db:generate hits the same tsx/os.userInfo() failure (despite returning exit code 0); the forward migration and idempotent application were verified through real SQLite unit tests, but QA should rerun the drift check and all integration cases outside the sandbox. No tooling was changed to bypass these limits. No separate PROC QA case document exists in docs/qa; the task's explicit unit/instrumentation cases and three TC-PROC cases were used.
- Changelog draft for the Architect to land: Add persisted process tracking, module pipelines and retry/cancel controls for sidecar activities ([PROC-01](PROC-01.md)).
