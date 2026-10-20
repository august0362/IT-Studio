# ADR-0006 — Supervised multi-agent orchestration (runtime, v1 add-on)

- Date: 2026-10-22 *(correction 2026-10-21: this date is in the future of the record — the ADR was committed on
  2026-10-16 in `0351aaf`; ORCH-01…04 landed 2026-10-17. The original text is kept unchanged below.)*
- Status: Accepted by owner instruction (master implementation prompt, 2026-10-22; answers in chat)
- Amended: 2026-10-21 by the stabilization pass — see "Amendments" at the end.
- Decision record: `../CONTEXT.md` D41
- Canonical roles: `docs/governance/MULTI_AGENT_ORCHESTRATION.md`
- Work orders: `docs/tasks/ORCH-01.md` … `ORCH-04.md`; test cases `docs/qa/ORCH-test-cases.md`

## Context

The owner wants IT Studio to run a supervised team on a user project: Claude plans a task DAG, two coding workers run in parallel when scopes allow, Codex reviews/integrates/fixes, Claude does a final review, and the owner approves the merge. Existing decisions constrain this:

- **D5** fixed pipeline roles (PM/Coder/Reviewer, 1 fix round) — the single-run pipeline stays as is; orchestration is a *separate run type* that reuses its building blocks (role caller, worker file operations, path guard, journal, validation commands).
- **D7** budget guard, **D10** model fallback, **D11** snapshot/rollback, **D16** workspace path + command restrictions — all reused, not bypassed.
- **D18** v2 agent orchestrator without a supervisor (M10) — this ADR adds a *supervisor-driven scheduler* as an add-on; the M10 agent registry/AgentRunner scope is unchanged and may later host these roles.
- **D21** on-demand only — every orchestration run starts from an explicit user click; no background runs.
- **D37** feature modules — the engine is a new sidecar module `apps/sidecar/src/modules/orchestration/` with an `index.ts` facade (created ahead of MOD-01; MOD later moves only its imports).
- **D40** processes — each run and each task attempt is a tracked process (`orchestration` kind) instead of a parallel observability system.

External tool facts verified on 2026-10-22: `claude 2.1.296` supports non-interactive `-p` with `--output-format json` and `--model`; `codex-cli 0.159.3` supports `codex exec` with `-m`, `-C`, `--json`, `-o`. `freebuff 0.2.29` has **no** non-interactive mode or model flag (CodebuffAI/freebuff#947); the owner decided to **drop Freebuff** (and with it Solar Pro 4) from the design.

## Decision

1. **Separate identities:** every agent is `{ agentId, roleId, modelId, providerId, transportId }`. Transports in v1: `api` (through `LlmRouter`, any keyed provider), `claude-cli` (`claude -p`), `codex-cli` (`codex exec`). Adding a transport = one adapter implementing `IAgentExecutionAdapter`.
2. **Roles:** `supervisor` (default Claude via `claude-cli`; fallback `api` with an Anthropic model), `worker` ×2 (default `api` DeepSeek V4 Flash and DeepSeek V4 Pro; user-selectable from keyed chat+code models), `reviewer` (default `codex-cli`; fallback `api`). Configured in Settings → Orchestration.
3. **The deterministic engine is the authority.** Model output is untrusted data: the supervisor's plan is a JSON DAG validated with Zod and by the engine (acyclic, known roles, allowedPaths inside the workspace, no overlap between concurrently runnable tasks unless serialized). Permissions, path checks, command allow-list, budgets and approvals are enforced in code.
4. **Isolation:** the target project must be a Git repository with a clean HEAD or the run is blocked with an explanation. Each task attempt gets a worktree `<project>/.itstudio/orch/<runId>/<taskId>-<attempt>` on branch `itstudio/orch/<runId>/<taskId>`; integration happens on `itstudio/orch/<runId>/integration`. Nothing is ever pushed; `main` (or the current branch) changes only through an owner-approved merge. Runtime runs never target IT Studio's own repository path.
5. **Workers via `api`** return the existing CoderOutput JSON (file operations); the engine applies them into the worktree through the path guard + task `allowedPaths`, then runs the task's allow-listed test commands. CLI workers are out of scope for v1.
6. **Review/integration:** the reviewer (Codex) receives the task contract + diff + test evidence and returns a structured verdict `{ verdict: 'pass' | 'fix_required' | 'reject', findings[] }`. Fix rounds: max 2 per task, then escalate to the supervisor (re-plan/reassign) or pause for the owner. Integration merges passing task branches sequentially into the integration branch; on conflict the reviewer gets an integration-fix task. Final: supervisor review → `AWAITING_APPROVAL` → owner clicks Approve → `git merge --no-ff` into the target branch.
7. **Budgets per run** (Settings, saved with a visible "Saved" confirmation): max cost (default USD 2, warn-and-pause), max wall-clock 60 min, max agent calls 40, max concurrent workers 2, max fix rounds 2, transient retry 1 (respect Retry-After), no retry on auth/billing/permission/safety errors. Token usage is recorded only when the provider/CLI reports it; unknown stays `null`, never 0. CLI subscription usage is recorded as calls/time with `costMicroUsd = null` and `billing: 'subscription'`.
8. **Persistence & recovery:** SQLite tables `orch_runs`, `orch_tasks`, `orch_attempts`, `orch_events` (migration). On startup unfinished runs become `PAUSED_INTERRUPTED`; attempts that were running become `UNKNOWN` (no automatic relaunch); the owner can inspect and resume, which starts *new* attempt IDs. Idempotency keys prevent duplicate ledger rows.
9. **UI:** Code tab gets an *Orchestration* view (start run, agents, DAG with live states, attempts, diffs, evidence, Approve/Cancel/Resume); Settings → Orchestration (roles, adapters with probe status, concurrency, budgets, retries); Processes shows runs/attempts.

## Consequences

- No Freebuff/Solar integration; the adapter interface keeps future CLIs possible if they gain a documented headless mode.
- Development orchestration of IT Studio itself keeps using `scripts/dev/run-task.sh`; aligning it with this engine is a later task.
- Mock-agent tests prove engine behaviour, not model quality; real-adapter smoke tests run only with the owner's keys/subscriptions.

## Amendments

### 2026-10-21 — stabilization pass (`docs/qa/stabilization/02-DEFECTS.md`, STAB-D01…D05)

Implementation defects found after ORCH-QA made parts of this decision ineffective; the fixes make the code match
the decision and settle details the decision left open. No role, transport or budget default changed.

1. **Final review is a gate (§6).** The supervisor's final review must parse as
   `{ approveForOwner: boolean, summary, risks[] }` (strict); only `approveForOwner: true` leads to
   `AWAITING_APPROVAL`. Rejection, invalid output, adapter failure/timeout or a missing supervisor pause the run.
2. **Conflicts (§6).** "The reviewer gets an integration-fix task" is realised without write access: the reviewer
   returns the resolved content of the conflicted files; the engine applies it through the write transaction and
   commits only when Git has no unmerged entry; otherwise the merge is aborted and the run pauses.
3. **Recovery (§8).** Attempts are persisted before any side effect; the restart sweep runs at sidecar startup; a
   resume continues from persisted attempts (completed tasks are kept, new attempt ids, no automatic relaunch).
4. **Approval (§6).** The approved object is the reviewed integration commit on top of the target commit it was built
   on. If the target branch moved (or the integration branch changed), the approval is stale: the run pauses and a
   resume re-integrates on the new tip, re-validates and asks for a new final review.
