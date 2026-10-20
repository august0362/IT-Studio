# orchestration

Supervised multi-agent orchestration (D41, ADR-0006): a supervisor agent plans a task DAG, workers run in Git
worktrees through the API (router), Claude CLI or Codex CLI adapters, reviewers gate each task, and the owner
approves the final merge.

- **RPC:** `orch.adapters`, `orch.plan`, `orch.start`, `orch.get`, `orch.list`, `orch.attempts`, `orch.cancel`,
  `orch.resume`, `orch.approve`, `orch.discard`.
- **Depends on:** kernel (process runner, validation), `processes` (run records), `settings` (agents and limits),
  `router` (API adapter), `cost` (recorded request cost), `pipeline` (process runner, command runner, write
  transactions), `projects` (repository).
