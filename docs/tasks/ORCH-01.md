# ORCH-01 — Orchestration engine core: contracts, persistence, DAG, scheduler (mock agents)

Milestone: ORCH (ADR-0006, CONTEXT D41) · Role: Implementer · Size L · Model: gpt-6-luna medium · **Deps pre-installed** · **Broad scope inside `apps/sidecar/src/**` (new module `modules/orchestration/**`, container wiring, migrations) and `src/types/schemas.ts` (additive section below) — do not stop for edits needed to meet a requirement; list them in Result**

## Read first

`docs/decisions/ADR-0006-supervised-multi-agent-orchestration.md`, `docs/governance/MULTI_AGENT_ORCHESTRATION.md`, `docs/qa/ORCH-test-cases.md` (implement ORCH-001, 003, 004, 009 here), existing `pipeline-orchestrator.ts`, `process-registry.ts`, `infra/sqlite/**`.

## Module layout (binding)

```text
apps/sidecar/src/modules/orchestration/
├── index.ts               # createOrchestrationModule(deps) → { engine, register(server), start(), stop() }
├── task-machine.ts        # PURE task state machine (states in governance §4); illegal transition → Result error
├── run-machine.ts         # PURE run states: DRAFT, PLANNING, PLAN_READY, RUNNING, PAUSED, PAUSED_INTERRUPTED, AWAITING_APPROVAL, COMPLETED, FAILED, CANCELLED
├── dag.ts                 # PURE validate(plan, workspaceRoot) and topological order, critical-path length
├── scheduler.ts           # PURE pickRunnable(state, limits, locks) → taskIds to start (critical path first, no starvation)
├── path-locks.ts          # PURE overlap detection for allowedPaths globs (prefix/glob intersection)
├── engine.ts              # orchestrates: plan → schedule → attempts via IAgentExecutionAdapter (port) → events
├── storage/schema.ts      # Drizzle tables orch_runs, orch_tasks, orch_attempts, orch_events (+ migration in the repo's migrations folder)
├── storage/orch-repository.ts
├── rpc.ts                 # orch.* handlers
├── adapters/mock-adapter.ts  # deterministic scripted adapter for tests (supervisor/worker/reviewer)
└── *.test.ts
apps/sidecar/src/ports/agent-execution.ts   # IAgentExecutionAdapter
```

## Contracts (`src/types/schemas.ts`, new section `/* §ORCHESTRATION (D41) */`, plus `validation/ipc.ts`)

```ts
export type OrchRunId = Brand<string, 'OrchRunId'>; export type OrchTaskId = Brand<string, 'OrchTaskId'>; export type OrchAttemptId = Brand<string, 'OrchAttemptId'>;
export const OrchRole = { SUPERVISOR: 'supervisor', WORKER: 'worker', REVIEWER: 'reviewer' } as const; export type OrchRole = (typeof OrchRole)[keyof typeof OrchRole];
export const OrchTransport = { API: 'api', CLAUDE_CLI: 'claude-cli', CODEX_CLI: 'codex-cli', MOCK: 'mock' } as const; export type OrchTransport = (typeof OrchTransport)[keyof typeof OrchTransport];
export interface OrchAgentRef { readonly agentId: string; readonly role: OrchRole; readonly transport: OrchTransport; readonly providerId?: ProviderId; readonly modelId?: string }
export const OrchTaskState = { DRAFT:'draft', READY:'ready', QUEUED:'queued', ASSIGNED:'assigned', RUNNING:'running', AWAITING_HANDOFF:'awaiting_handoff', IN_REVIEW:'in_review', FIX_REQUIRED:'fix_required', INTEGRATING:'integrating', VALIDATING:'validating', AWAITING_APPROVAL:'awaiting_approval', COMPLETED:'completed', BLOCKED:'blocked', FAILED:'failed', CANCELLED:'cancelled' } as const;
export type OrchTaskState = (typeof OrchTaskState)[keyof typeof OrchTaskState];
export const OrchRunState = { DRAFT:'draft', PLANNING:'planning', PLAN_READY:'plan_ready', RUNNING:'running', PAUSED:'paused', PAUSED_INTERRUPTED:'paused_interrupted', AWAITING_APPROVAL:'awaiting_approval', COMPLETED:'completed', FAILED:'failed', CANCELLED:'cancelled' } as const;
export type OrchRunState = (typeof OrchRunState)[keyof typeof OrchRunState];
export interface OrchTaskSpec { readonly id: OrchTaskId; readonly title: string; readonly objective: string; readonly dependsOn: readonly OrchTaskId[]; readonly role: 'worker'; readonly candidateAgents: readonly string[]; readonly allowedPaths: readonly string[]; readonly testCommands: readonly CommandSpec[]; readonly acceptanceCriteria: readonly string[]; readonly estimate: 'S' | 'M' | 'L'; readonly timeoutMs: number }
export interface OrchUsage { readonly inputTokens: number | null; readonly outputTokens: number | null; readonly cachedInputTokens: number | null; readonly reasoningTokens: number | null; readonly source: 'provider' | 'cli' | 'estimated' | 'unknown'; readonly costMicroUsd: MicroUsd | null; readonly billing: 'api' | 'subscription' | 'free' | 'unknown' }
export interface OrchAttempt { readonly id: OrchAttemptId; readonly taskId: OrchTaskId | null; readonly role: OrchRole; readonly agent: OrchAgentRef; readonly state: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'; readonly reason?: string; readonly worktree?: string; readonly baseSha?: string; readonly headSha?: string; readonly changedFiles: readonly string[]; readonly evidence: readonly CommandRun[]; readonly verdict?: { readonly verdict: 'pass' | 'fix_required' | 'reject'; readonly findings: readonly { readonly severity: FindingSeverity; readonly path: string; readonly line?: number; readonly message: string; readonly suggestedFix: string }[]; readonly summary: string }; readonly usage: OrchUsage; readonly startedAt: IsoDateTime; readonly endedAt?: IsoDateTime }
export interface OrchTask extends OrchTaskSpec { readonly state: OrchTaskState; readonly stateReason?: string; readonly assignedAgentId?: string; readonly fixRounds: number; readonly attempts: readonly OrchAttemptId[] }
export interface OrchLimits { readonly maxCostMicroUsd: MicroUsd; readonly maxWallClockMs: number; readonly maxAgentCalls: number; readonly maxConcurrentWorkers: number; readonly maxFixRounds: number; readonly transientRetries: number; readonly hardStop: boolean }
export interface OrchRun { readonly id: OrchRunId; readonly projectId: ProjectId; readonly request: string; readonly state: OrchRunState; readonly stateReason?: string; readonly agents: readonly OrchAgentRef[]; readonly tasks: readonly OrchTask[]; readonly limits: OrchLimits; readonly targetBranch: string; readonly integrationBranch?: string; readonly costMicroUsd: MicroUsd; readonly agentCalls: number; readonly createdAt: IsoDateTime; readonly updatedAt: IsoDateTime }
export type OrchEvent = { readonly type: 'run'; readonly run: OrchRun } | { readonly type: 'task'; readonly runId: OrchRunId; readonly task: OrchTask; readonly reason: string } | { readonly type: 'attempt'; readonly runId: OrchRunId; readonly attempt: OrchAttempt };
// RPC
'orch.plan': { params: { readonly projectId: ProjectId; readonly request: string }; result: OrchRun };          // runs the supervisor, returns PLAN_READY run
'orch.start': { params: { readonly runId: OrchRunId }; result: OrchRun };
'orch.cancel': { params: { readonly runId: OrchRunId }; result: OrchRun };
'orch.resume': { params: { readonly runId: OrchRunId }; result: OrchRun };
'orch.approve': { params: { readonly runId: OrchRunId }; result: OrchRun };       // ORCH-03 implements the merge
'orch.discard': { params: { readonly runId: OrchRunId }; result: OrchRun };
'orch.get': { params: { readonly runId: OrchRunId }; result: OrchRun };
'orch.list': { params: { readonly projectId?: ProjectId; readonly limit: number }; result: readonly OrchRun[] };
'orch.attempts': { params: { readonly runId: OrchRunId; readonly taskId?: OrchTaskId }; result: readonly OrchAttempt[] };
// notification
'orch.event': OrchEvent;
```

## Requirements (this task)

1. Port `IAgentExecutionAdapter { id: OrchTransport; probe(): Promise<{ status: 'available' | 'unavailable' | 'unsupported'; version?: string; reason?: string }>; capabilities(): { roles: OrchRole[]; structuredOutput: boolean; usage: boolean; cancel: boolean }; run(envelope, input, signal, onEvent): Promise<Result<AgentOutput>> }` where `envelope` follows governance §2 and `AgentOutput = { ack, payload: unknown, usage: OrchUsage }`.
2. `dag.validate`: Zod schema for the supervisor plan `{ tasks: OrchTaskSpec[] }` (1–20 tasks, ids unique `T1…`, deps exist, acyclic, `allowedPaths` workspace-relative without `..`/absolute/`.git`/`node_modules`/`.itstudio`, ≥1 acceptance criterion, testCommands from the project's allow-listed validation commands only). Errors → `PLAN_INVALID` with a list.
3. Scheduler: a task is runnable when deps are `COMPLETED` (or integrated), no path-lock overlap with running/in-review tasks (`path-locks.ts`: two globs overlap if one prefix-contains the other or they can match a common path), workers below `maxConcurrentWorkers`, budget/agent-call limits not reached. Order: longest remaining critical path first; ties by id. A failed task blocks only its transitive dependents.
4. Engine loop with the **mock adapter only** in this task: plan (supervisor mock) → schedule → worker attempt → reviewer attempt → on `fix_required` new worker attempt (max `maxFixRounds`) → on exhaustion escalate (supervisor mock decides `reassign` once, then run `PAUSED` with reason `NEEDS_OWNER`) → all tasks reviewed ⇒ run `AWAITING_APPROVAL` (merge itself is ORCH-03). Workers apply nothing to disk in this task (mock).
5. Persistence: every run/task/attempt/event change stored (batched ≤ 500 ms), events published as `orch.event` (coalesced ≤ 10/s per run), and a `process` (D40) of kind `orchestration` is upserted per run (add the kind to the process registry with modules = task ids).
6. Default limits: cost USD 2 (`maxCostMicroUsd: 2_000_000`), 60 min, 40 calls, 2 workers, 2 fix rounds, 1 transient retry, `hardStop: false` (warn-and-pause).

## Tests

ORCH-001, ORCH-003, ORCH-004, ORCH-009 (unit, names prefixed), plus state-machine tables (every legal and a sample of illegal transitions), DAG validation errors, scheduler ordering/fairness, persistence round-trip, event coalescing.

## Acceptance criteria

- [ ] `npx prettier --write` changed files; `npm run typecheck`, `npm run lint`, `npm test` pass. QA runs a new `apps/sidecar/test/integration/orchestration.test.ts` smoke (plan → start → awaiting_approval with mock adapter) — add it.

## Hand-back

Append `## Result` per AGENTS.md §3.

## Result
- Summary: Completed mock worker/reviewer attempts, bounded fix rounds, supervisor escalation to `NEEDS_OWNER`, dependency blocking, critical path scheduling and process graph upserts for orchestration runs.
- Files changed: `src/types/schemas.ts`; `apps/sidecar/src/{container.ts,domain/process-graphs.ts,domain/remediation.ts,infra/sqlite/**,modules/orchestration/**,ports/agent-execution.ts,services/process-registry.ts,validation/**}`; `apps/sidecar/test/integration/orchestration.test.ts`; `apps/desktop/src/features/processes/ProcessesPage.tsx`; this task record.
- Dependencies added (with reason): None. `node_modules` was already present.
- Decisions taken within scope: Escalation records one supervisor reassignment decision and pauses for owner input without launching an extra worker attempt, matching ORCH-009.
- Open issues / follow-ups: Startup recovery and real merges remain ORCH-03. `npm test` is blocked in its `pretest` lint selftests because Git cannot read `C:\Users\admin\.config\git\ignore` in this sandbox. `npm run typecheck`, `npm run lint`, the requested orchestration Vitest suite (7 tests), and the integration smoke (2 tests) pass. The desktop process icon map was a necessary shared-contract consumer update.

## QA round 1

Your Result lists gaps. Complete exactly these (budget enforcement beyond the agent-call/worker counters, recovery and real merges stay in ORCH-03):

1. **Requirement 3 (scheduler)** fully: `pickRunnable` must honour deps COMPLETED, path-lock overlap with tasks in `running | awaiting_handoff | in_review | fix_required`, `maxConcurrentWorkers`, `maxAgentCalls`; order by longest remaining critical path, tie by id; a failed task blocks only transitive dependents (`BLOCKED`, reason `DEPENDENCY_FAILED`).
2. **Requirement 4 (engine loop with mock adapter)**: worker attempt → reviewer attempt (mock verdict) → `pass` ⇒ task `completed`; `fix_required` ⇒ `FIX_REQUIRED` then a new worker attempt with the findings (new attempt id), up to `maxFixRounds`; exhaustion ⇒ one supervisor escalation (`reassign` to the other worker agent) ⇒ if it still fails, run `PAUSED` with reason `NEEDS_OWNER`. All tasks completed ⇒ run `AWAITING_APPROVAL`.
3. **Requirement 5**: add process kind `orchestration` to the process registry (graph = the run's tasks as modules, edges = deps; module state from task state) and upsert it on every run/task change; `orch.event` coalesced ≤ 10/s per run.
4. **Tests (names prefixed):** `ORCH-001` (valid DAG accepted; cycle, unknown dep, duplicate id, `..`/absolute path, empty acceptance criteria rejected), `ORCH-003` (overlapping allowedPaths ⇒ second QUEUED with reason `PATH_LOCK` until the first leaves review), `ORCH-004` (A fails ⇒ B BLOCKED, independent C completes), `ORCH-009` (reviewer always `fix_required` ⇒ exactly `maxFixRounds` fix attempts, one escalation, then `PAUSED`/`NEEDS_OWNER`, no extra worker attempt); task/run state-machine transition tables; scheduler ordering.
5. Extend `apps/sidecar/test/integration/orchestration.test.ts`: plan → start → mock review pass → `awaiting_approval`, and a `fix_required` once path.

Run prettier, typecheck, lint and `npx vitest run --project sidecar apps/sidecar/src/modules/orchestration`. Update `## Result`.
