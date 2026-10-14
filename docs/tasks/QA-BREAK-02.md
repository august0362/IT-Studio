# QA-BREAK-02 — Adversarial suite: concurrency, sync, crash durability, upgrade

Milestone: v1 hardening (owner request 2026-10-14: test sync and conflict handling and every case that could break the project) · Role: Implementer (ROLES §1.3) · Tests only · **Deps pre-installed** · Runs in parallel with QA-BREAK-01 (disjoint scope)

## Goal

Try to break state consistency with races, interleavings, process kills and data from an older install. Every test asserts the **correct** behaviour from the contracts and decisions. A test that exposes a product defect stays in the suite as `it.fails('QA-BREAK-02-Dnn <description>', …)` and is listed in `## Result`. Do **not** fix product code in this task.

## Read first

`AGENTS.md`, `CONTEXT.md` D4, D7, D10, D11, D13, D21, D32, `ARCHITECTURE.md` (router, ledger/budget, pipeline + journal, RAG ingest, workflow map, settings), `src/types/schemas.ts`, `apps/sidecar/test/integration/harness.ts` (read-only) and the existing integration tests (`chat.test.ts`, `budget.test.ts`, `pipeline.test.ts`, `rag-ingest.test.ts`, `settings-projects.test.ts`, `workflow.test.ts`, `startup.test.ts`), `apps/sidecar/src/services/write-transaction.ts` (`ITSTUDIO_E2E_CRASH_AT`).

## Scope — files you may create/modify

- `apps/sidecar/test/integration/break-concurrency.test.ts` (new)
- `apps/sidecar/test/integration/break-durability.test.ts` (new)
- `apps/sidecar/test/integration/break-helpers-02.ts` (new; helpers only for these files)
- `apps/sidecar/test/integration/fixtures/break-02/**` (new; include an old-version database fixture, see BRK-D06)
- `apps/desktop/src/features/break-ui-races.test.tsx` (new; L2 component races with the fake RPC client already used by desktop tests)
- This task file (`## Result` / `## Blocked` only)

Do **not** edit `harness.ts`, other tests, product code, configs or `package.json`.

## Cases (name each test with its ID)

### Concurrency and sync (L3)
- **BRK-C01** Two `pipeline.start` calls for the same project sent in the same tick: exactly one run starts and the other is rejected (D13: one run per project); `pipeline.list` shows one active run.
- **BRK-C02** Pipelines in two projects started in parallel: both complete; every `pipeline.event` and ledger row carries the correct `projectId` (no cross-attribution).
- **BRK-C03** `project.setActive` switched back and forth 50 times while a `chat.send` stream is in flight: deltas and the final message land in the original conversation and project; the ledger row belongs to the original project.
- **BRK-C04** `chat.cancel` races: cancel before the first delta, cancel twice, cancel after `chat.completed`, cancel an unknown id: no crash, exactly one terminal event per request, and no ledger row for a request cancelled before any provider call.
- **BRK-C05** 20 parallel `chat.send` on the same conversation: message order in `chat.getMessages` is consistent, nothing is lost or duplicated, and ledger rows equal the number of completed calls.
- **BRK-C06** 50 concurrent `settings.update` calls, each patching a **different** field: after they finish, every patched field holds its value (no lost update from read-modify-write).
- **BRK-C07** `router.updateConfig` (ladder reorder plus Auto Fallback off) while a chat stream is in flight: the in-flight request finishes on its original plan or fails cleanly; the next request uses the new config.
- **BRK-C08** Budget Hard Stop under concurrency (D7): budget set just above the cost of one call, then 10 parallel paid calls with scripted costs. At most the calls admitted before the limit was crossed run; afterwards every call fails `BUDGET_HARD_STOP`; record the actual overspend and assert it is bounded by the in-flight calls.
- **BRK-C09** `rag.ingest` of the same source twice concurrently, and `rag.deleteDocument` while that source is ingesting: no duplicate chunks for a file in `rag.query` results, no orphan vectors after delete, and the job ends in a terminal state.
- **BRK-C10** `pricing.refresh` twice concurrently (scripted pricing HTTP and extractor): one price-table version is applied or both are applied in order; `pricing.getRows` is never a half-applied mix.
- **BRK-C11** `secrets.verifyAndSave` and `secrets.delete` for the same provider interleaved 20 times with the scripted verifier and fake key store: the final `secrets.status` matches the last completed operation, and `secrets.history` has one entry per operation.
- **BRK-C12** Workflow map burst (D32): 100 activity events per second for 5 s (for example, many fast `rag.query` calls) do not block RPC responses (ping p95 < 200 ms during the burst), and `workflow.activity` stays within the retention bounds.

### Crash durability and restart (L3; kill the sidecar process with `TerminateProcess` / `kill('SIGKILL')`)
- **BRK-D01** Kill the sidecar during a burst of ledger writes: after restart, SQLite opens (WAL recovery), `PRAGMA integrity_check` reports ok, no duplicate ledger rows, and P&L totals equal the sum of the remaining rows.
- **BRK-D02** For every crash point supported by `ITSTUDIO_E2E_CRASH_AT`: restart with the same data dir and project; journal recovery restores a byte-identical project tree (hash before and after) and the run is marked failed, not running.
- **BRK-D03** Kill during `rag.ingest`: after restart the job is not shown as running forever; re-ingest completes and `rag.query` returns no duplicates.
- **BRK-D04** Corrupt state: a truncated SQLite WAL file, a settings row containing invalid JSON, and a deleted LanceDB directory each lead to either a clean start with defaults (and a logged warning) or a fatal error with a clear message; never a hang or a silent data wipe of unrelated tables.
- **BRK-D05** Two sidecars started on the **same** data dir at the same time: the second refuses to start or both stay consistent; the database is not corrupted (integrity check after both exit).
- **BRK-D06** Upgrade path: build a database with the v0.1.0 schema (migrations `0000`–`0010` only, using the migration SQL files from the repository) containing projects, conversations, ledger rows, revenue, settings and price overrides; start the current sidecar on it; migration `0011` applies, all old data is intact, and API-key status / pricing provenance treat legacy rows conservatively.
- **BRK-D07** Read-only data directory (set the directory or database file read-only): the sidecar fails fast with a clear fatal error instead of hanging or crashing in a loop.

### UI races (L2, `break-ui-races.test.tsx`, fake RPC client)
- **BRK-U01** Double-click and Enter-spam on Send, Save key, Start pipeline and Add revenue send exactly one request each.
- **BRK-U02** Switching project tabs while chat, pipeline and workflow responses are pending: late responses for the old project never render in the new project.
- **BRK-U03** A sidecar restart (status store goes Disconnected → Ready) while a form is half-filled: the draft is either kept or cleared with a notice; there is no uncaught error and the app stays mounted.
- **BRK-U04** Cost page custom range: type every prefix of a date, paste invalid dates, and reverse the range repeatedly; the page stays mounted (M9-FIX7 regression with fuzzing over 200 random strings).

## Requirements

1. Use only `startSidecar` from `harness.ts`, the fake/scripted `ITSTUDIO_E2E*` variables and temp dirs. No real network, provider or keychain.
2. Clean up every process and temp dir, including on failure. Each file stays under 90 s on a normal run.
3. The Codex sandbox cannot run integration tests (ENV-1). Run `npm run typecheck`, `npm run lint` and the L2 file (`npx vitest run apps/desktop/src/features/break-ui-races.test.tsx`); record that QA must run `npx vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/break-*.test.ts`.

## Acceptance criteria

- [ ] Every case above exists as a test with its ID in the name (or an explicit `it.skip` with the environment reason).
- [ ] Every defect found is an `it.fails('QA-BREAK-02-Dnn …')` test and a row in the `## Result` defect table: ID, case, severity guess (S1–S4), observed vs expected behaviour.
- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint` and the L2 file pass.

## Hand-back

Append `## Result` per AGENTS.md §3, including the defect table.
