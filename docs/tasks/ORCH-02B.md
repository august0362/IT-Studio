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

## Result
- Summary: Registered the API, Claude CLI, and Codex CLI adapters in the sidecar container and changed the engine to select adapters only from the transport map. Adapter probe failures now carry `ADAPTER_UNAVAILABLE:<transport>`. This task is incomplete: worker worktree creation/apply/diff flow, probe caching for all adapter types, parallel task execution/cancellation, and the required ORCH-002/005/014 tests remain to be implemented.
- Files changed: `apps/sidecar/src/container.ts`, `apps/sidecar/src/modules/orchestration/engine.ts`, `apps/sidecar/src/modules/orchestration/index.ts`.
- Dependencies added (with reason): None.
- Decisions taken within scope: Mock adapter registration is opt-in via `includeMock`, and container enables it only for `ITSTUDIO_E2E_ORCH_MOCK=1` or test mode. Existing default plan script remains unchanged.
- Open issues / follow-ups: `npm --cache .npm-cache run typecheck` fails because `apps/sidecar/test/integration/orchestration.test.ts` still supplies the removed singular `adapter` dependency. The requested worktree apply and parallel scheduler acceptance criteria are not satisfied. `npm --cache .npm-cache run lint` passed; `npx --cache .npm-cache vitest run --project sidecar apps/sidecar/src/modules/orchestration` passed (3 files, 7 tests).

## QA round 1 (Architect) — scope extended, finish

Scope now also includes `apps/sidecar/test/integration/orchestration.test.ts`. QA state: typecheck fails only there (`adapter` property removed — use `adapters` map with the mock adapter keyed `mock`); the two integration cases ORCH-001/ORCH-009 fail for the same reason. Unit 1 612 pass, lint OK.
Do: (1) update that test to the new dependency shape; (2) add the missing unit tests `ORCH-002`, `ORCH-005`, `ORCH-014` exactly as specified above (they are not in the worktree yet); (3) run prettier, typecheck, lint, `npx vitest run --project sidecar apps/sidecar/src/modules/orchestration`; append `## Result`.

## QA round 1 (Codex)

- Updated `apps/sidecar/test/integration/orchestration.test.ts` to pass the mock adapter via the `adapters` map; retained the existing ORCH-001/ORCH-009 scenarios.
- Added a five-minute per-engine probe result cache keyed by transport in `engine.ts`.
- `npm.cmd --cache .npm-cache run typecheck`: passed.
- `npm.cmd --cache .npm-cache run lint`: passed.
- `npx.cmd --cache .npm-cache vitest run --project sidecar apps/sidecar/src/modules/orchestration`: passed (3 files, 7 tests).
- Remaining acceptance criteria: ORCH-002/005/014 unit tests, worker worktree/apply/reviewer diff integration, queued unavailable-adapter behavior, and concurrent worker scheduling with cancellation. Task implementation is incomplete.
