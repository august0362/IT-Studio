# ORCH-AG — Finish the orchestration engine (implementer: Antigravity)

Milestone: ORCH (ADR-0006, D41) · Implementer: Antigravity · Reviewer: Codex · Final QA: Claude · Worktree: `C:/Users/admin/itstudio-wt/ORCH-AG` (branch `task/ORCH-AG`, based on ORCH-02C) · **node_modules installed — do not run npm install or change package.json / lockfiles.**

## Rules (from `AGENTS.md`, binding)

- Work only in this worktree. Do not `git commit`, `push`, `reset`, `checkout` other branches or delete branches.
- Do not edit `docs/CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/ROLES.md`, `docs/ROADMAP.md`, `docs/CONVENTIONS.md`, `AGENTS.md`, `CHANGELOG.md`.
- Contracts come from `@itstudio/schemas` (`src/types/schemas.ts`); additive changes only where this file says so.
- No `any`, `@ts-ignore`, `eslint-disable`, TS `enum`, `namespace`, default exports, `shell: true`, raw SQL. No real network or keychain in tests.
- Paths in Markdown inside `docs/` are relative to the file (e.g. `../TESTING.md`), never `docs/...`.

Read first: `docs/decisions/ADR-0006-supervised-multi-agent-orchestration.md`, `docs/governance/MULTI_AGENT_ORCHESTRATION.md`, `docs/qa/ORCH-test-cases.md`, `apps/sidecar/src/modules/orchestration/**` (engine.ts, scheduler.ts, path-locks.ts, workspace.ts, worktrees.ts, adapters/*, index.ts), `apps/sidecar/test/integration/orchestration.test.ts`.

## Work items (all required)

### A. Lint clean-up (from ORCH-02C)
`npm run lint` reports 22 errors in `apps/sidecar/src/modules/orchestration/engine.test.ts` (`require-await` on async arrows without `await`, `restrict-template-expressions` for numbers). Fix them without weakening tests (use `Promise.resolve(...)` / `String(n)`).

### B. Adapter availability gating (ORCH-014)
In `engine.ts`, before assigning an agent call `adapter.probe()` (the 5-minute cache in `index.ts` already exists — reuse it). Not `available` ⇒ do not assign; task stays `queued` with `stateReason: 'ADAPTER_UNAVAILABLE:<transport>'`; if no candidate agent for a required role is available, run `paused` with that reason. Test `ORCH-014` (unit): `unavailable` and `unsupported` adapters are never invoked; run paused.

### C. Parallel pool + cancellation (ORCH-002, ORCH-011)
Replace the sequential task loop in `OrchestrationEngine.run` with a pool: repeatedly call `pickRunnable(...)`; start up to `run.limits.maxConcurrentWorkers` task pipelines (worker attempt → reviewer attempt → fix rounds) concurrently; when one settles (`Promise.race` over the running set) re-evaluate; stop when nothing is runnable/running. Shared counters (`calls`, cost) must be updated atomically (single-threaded JS is fine, but check limits before each call). `cancel(runId)` aborts all in-flight attempts via one `AbortController` passed to adapters and `workspace.applyWorker`; tasks become `cancelled`. Tests: `ORCH-002` (unit, fake clock/adapters: two independent tasks both start before either finishes), `ORCH-011` (unit: cancel while two attempts run ⇒ both adapters receive abort, tasks `cancelled`, run `cancelled`).

### D. Integration, approval and budgets (ORCH-03 scope)
1. **Integration branch:** after all tasks pass review, create `itstudio/orch/<runId>/integration` worktree from the run base SHA (add `prepareIntegration(run)` and `mergeTask(run, integration, taskWorktree)` to `IOrchWorkspace`/`OrchWorkspace`, using `git merge --no-ff` with argument arrays). Merge passing task branches in topological order. On conflict, create one reviewer attempt with role `reviewer` and input `{ kind: 'integration-conflict', diff }`; if it still conflicts ⇒ run `paused` `INTEGRATION_CONFLICT`. Then run the project's validation commands in the integration worktree (reuse the command runner); store evidence on the run.
2. **Final review + approval:** supervisor attempt with input `{ kind: 'final-review', integrationDiff, evidence }` ⇒ run `awaiting_approval`. `orch.approve` (RPC already declared) merges the integration branch into `run.targetBranch` in the project root with `git merge --no-ff`, only if `git status --porcelain` is clean for the files touched by the run (else `CONFLICT`). `orch.discard` removes the run's worktrees/branches through `WorktreeManager.cleanup`. Never push.
3. **Budgets:** before every agent call check `maxAgentCalls`, `maxWallClockMs`, `maxCostMicroUsd` (cost = sum of attempt `usage.costMicroUsd` that are not null) ⇒ run `paused` with reason `BUDGET_CALLS | BUDGET_TIME | BUDGET_COST`. Unknown usage stays `null` (never 0).
4. **Safety:** refuse runs whose project root equals or is inside the IT Studio repository/install directory (`TARGET_FORBIDDEN`; compare canonical paths against `process.cwd()` of the sidecar and the app executable directory passed via deps).
5. **Recovery:** on module `start()`, runs in `running` ⇒ `paused_interrupted`, attempts `running` ⇒ `unknown`; `orch.resume` continues with new attempt ids; never relaunch automatically.
Tests (unit with fakes, names prefixed): `ORCH-007`, `ORCH-008`, `ORCH-010`, `ORCH-012` (unit level: restart sweep + resume new ids), `ORCH-015`, `ORCH-016`, `ORCH-017`. Extend `orchestration.test.ts` (integration) with a temp Git repo: plan → start (mock adapters writing a file) → awaiting_approval → approve ⇒ exactly one `--no-ff` merge commit in the temp repo; an unrelated modified file in the temp repo is untouched (`ORCH-013`).

## Definition of done

`npx prettier --write <changed files>`, then `npm run typecheck`, `npm run lint`, `npx vitest run --project sidecar apps/sidecar/src/modules/orchestration` pass. (Integration tests: run `npx vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/orchestration` if your environment allows; QA reruns.) Append to this file:

```markdown
## Result
- Summary / Files changed / Decisions / Tests added (IDs) / Open issues
```
