# ORCH-03 — Review, integration, approval gate, budgets, recovery

Milestone: ORCH (ADR-0006, D41) · **After ORCH-02** · Role: Implementer · Size L · Model: gpt-6-luna medium · **Deps pre-installed** · **Broad scope inside `apps/sidecar/src/modules/orchestration/**` and the budget/ledger services it reuses — list cross-module edits in Result**

## Read first

ADR-0006 §6–§8, governance §3–§5, `docs/qa/ORCH-test-cases.md` (implement ORCH-007, 008, 010, 012, 013, 015, 016, 017), ORCH-01/02 Results, `services/budget-guard.ts`, `services/ledger-service.ts`, `services/journal-recovery.ts`.

## Requirements

1. **Review loop** (ORCH-007/008): after a worker attempt, the reviewer gets the contract + diff (`git diff <base>..<head>`) + evidence; verdict JSON validated. `pass` ⇒ task `INTEGRATING`; `fix_required` ⇒ `FIX_REQUIRED`, findings passed to the next worker attempt (same worktree branch, new attempt id); `reject` ⇒ escalate. Max `maxFixRounds`, then supervisor escalation once (reassign to the other worker or re-plan the task), then `PAUSED` `NEEDS_OWNER`.
2. **Integration:** create `itstudio/orch/<runId>/integration` worktree from the base SHA; merge passing task branches in topological order with `git merge --no-ff`; on conflict create an integration-fix attempt for the reviewer (codex-cli, `-s workspace-write` in the integration worktree only); after all merges run the project's full validation commands (regression) ⇒ `VALIDATING` evidence.
3. **Final review + approval** (ORCH-016): supervisor final review over the integration diff and evidence ⇒ run `AWAITING_APPROVAL` with summary/risks. `orch.approve` (owner action only) merges the integration branch into `targetBranch` with `--no-ff` in the main worktree, only if the main worktree is clean for touched paths; otherwise `CONFLICT` with guidance. `orch.discard` removes run worktrees/branches. Never push.
4. **Budgets** (ORCH-010/017): before every agent call check `maxCostMicroUsd`, `maxAgentCalls`, `maxWallClockMs`, existing BudgetGuard (project/global; respect Hard Stop), adapter availability, required approvals ⇒ else run `PAUSED` with an explicit reason; with `hardStop: false` the owner gets a warning and can raise the limit and resume. Record usage per attempt; unknown counts stay `null`; ledger rows only for API calls with known cost, purpose `orchestration_*`, idempotency key = attempt id; CLI subscription calls recorded as `billing: 'subscription'`, cost `null`.
5. **Safety** (ORCH-013/015): refuse targets equal to/inside IT Studio's own repo or install dir (`TARGET_FORBIDDEN`); block start when owned paths are dirty; never touch unrelated working-tree changes (test: an untracked/modified unrelated file survives the whole run and approval).
6. **Recovery** (ORCH-012): on sidecar start, unfinished runs ⇒ `PAUSED_INTERRUPTED`, running attempts ⇒ `unknown` (no relaunch); `orch.resume` re-checks worktrees and continues with new attempt ids; no duplicate ledger rows (idempotency).
7. **Retries:** transient transport failures (timeout, 5xx, 429 with Retry-After) retried once; never retry auth/billing/permission/safety errors or operations with uncertain side effects.

## Tests

ORCH-007, 008, 010, 012, 013, 015, 016, 017 (names prefixed): unit with fakes + integration in `orchestration.test.ts` using mock adapters and a temp Git repo (kill/restart for 012).

## Acceptance criteria

- [ ] `npx prettier --write`, `npm run typecheck`, `npm run lint`, `npm test` pass; QA runs `orchestration.test.ts`.

## Hand-back

Append `## Result` per AGENTS.md §3.
