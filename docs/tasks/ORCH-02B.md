# ORCH-02B — Wire real adapters, worker apply and parallel execution into the engine

Milestone: ORCH (ADR-0006, D41) · Role: Implementer · Size M · Model: gpt-6-luna medium · **Deps pre-installed (node_modules complete — do not run npm install)** · Scope: `apps/sidecar/src/modules/orchestration/**`, `apps/sidecar/src/container.ts` (orchestration wiring only), this task file.

## Current state (main, after ORCH-02 partial)

- `modules/orchestration/index.ts:43-46` builds the engine with `adapter: mockAdapter` and passes `adapters: adapterMap`; `container.ts:1006` calls `createOrchestrationModule` without real adapters.
- `engine.ts` `OrchestrationEngine.run()` invokes the single `deps.adapter` for every role and processes tasks one after another.
- `worktrees.ts` exports `WorktreeManager` and `applyWorkerOutput(...)` (line 97) but nothing calls them.
- Adapters exist: `ApiAgentAdapter`, `ClaudeCliAdapter`, `CodexCliAdapter`, `MockAgentAdapter`; `orch.adapters` RPC exists.

## Do exactly this

1. **container.ts**: create `ApiAgentAdapter` (with the existing `LlmRouter`), `ClaudeCliAdapter`, `CodexCliAdapter` (with the existing process runner) and pass them as `adapters` to `createOrchestrationModule`. Register `MockAgentAdapter` only when `process.env.ITSTUDIO_E2E_ORCH_MOCK === '1'` or in tests.
2. **index.ts / engine.ts**: remove the single `adapter` dependency; for every attempt pick `adapterMap.get(agent.transport)`; before assigning, require `probe().status === 'available'` (cached 5 min); otherwise the task stays `queued` with reason `ADAPTER_UNAVAILABLE:<transport>` and the run pauses if no candidate agent is available.
3. **Worker apply**: for a worker attempt, call `WorktreeManager.create(runId, taskId, attemptNo, baseSha)` before invoking the adapter, pass the worktree path in the envelope, then call `applyWorkerOutput(...)` with the payload; store `changedFiles`, `baseSha`, `headSha`, `evidence` on the attempt. `PATH_DENIED` / `ROLE_ACK_MISMATCH` fail the attempt without writes. The reviewer envelope gets `git diff <baseSha>..<headSha>` (via `WorktreeManager`).
4. **Parallel execution**: replace the sequential task loop with a pool: while the run is active, call `pickRunnable(...)` and start up to `maxConcurrentWorkers` worker attempts concurrently (`Promise` per task; await `Promise.race` of running ones), re-evaluating after each completion; reviewer attempts run as soon as a worker attempt finishes. Cancellation aborts all in-flight attempts.
5. **Unit tests (names prefixed)** in `modules/orchestration/*.test.ts` with fake adapters/worktree manager: `ORCH-002` (two independent tasks: both workers started before either finishes — assert overlapping start/end timestamps from a fake clock), `ORCH-005` (envelope contains role, allowedPaths, worktree, attemptId; ack mismatch ⇒ `ROLE_ACK_MISMATCH`, `applyWorkerOutput` not called), `ORCH-014` (adapter `unavailable`/`unsupported` ⇒ never assigned; run paused with `ADAPTER_UNAVAILABLE`).

Run prettier, `npm run typecheck`, `npm run lint`, `npx vitest run --project sidecar apps/sidecar/src/modules/orchestration`. Append `## Result`.
