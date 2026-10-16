# ORCH — Test cases and traceability (ADR-0006, D41)

Every **auto** case gets a test whose name starts with its ID. Layers: **U** unit (pure/engine with fakes), **I** integration (real sidecar, mock agents, temp Git repo), **E** E2E, **M** manual with real agents.

| ID | Layer | Case | Expected | Task |
|---|---|---|---|---|
| ORCH-001 | U auto | Supervisor (mock) returns a plan for one request | Valid DAG accepted; cycles, unknown roles, paths outside workspace, duplicate ids rejected with `PLAN_INVALID` | ORCH-01 |
| ORCH-002 | I auto | Two independent tasks, concurrency 2 | Both `RUNNING` at the same time (event timestamps overlap), both complete | ORCH-01/02 |
| ORCH-003 | U auto | Two runnable tasks claim overlapping `allowedPaths` | Second waits (`QUEUED`, reason `PATH_LOCK`) until the first leaves review | ORCH-01 |
| ORCH-004 | U auto | Task B depends on A; A fails | B `BLOCKED` (reason `DEPENDENCY_FAILED`); independent task C still runs | ORCH-01 |
| ORCH-005 | U auto | Worker invocation | Envelope has the task's role, allowedPaths, worktree; ack mismatch ⇒ `ROLE_ACK_MISMATCH`, no writes | ORCH-02 |
| ORCH-006 | I auto | Worker returns an operation outside allowedPaths (and a `..` / junction path) | Attempt fails `PATH_DENIED`; worktree unchanged | ORCH-02 |
| ORCH-007 | U auto | Reviewer (mock) returns `fix_required` | Task → `FIX_REQUIRED`, findings stored | ORCH-03 |
| ORCH-008 | I auto | After `fix_required`, worker fixes, reviewer passes | New attempt id, re-review, task `COMPLETED` path continues | ORCH-03 |
| ORCH-009 | U auto | Reviewer keeps failing | Stops after 2 fix rounds ⇒ escalation to supervisor, then owner pause; no third worker attempt | ORCH-01/03 |
| ORCH-010 | U auto | Budget max cost reached / required approval missing / adapter unavailable | Run `PAUSED` with reason; no agent call started | ORCH-03 |
| ORCH-011 | I auto | Cancel during a running CLI attempt (mock CLI = node script that sleeps) | Child process tree terminated, attempt `CANCELLED`, no orphan processes | ORCH-02 |
| ORCH-012 | I auto | Kill sidecar mid-run, restart | Run `PAUSED_INTERRUPTED`, attempt `UNKNOWN`; resume creates new attempt ids; ledger has no duplicate rows | ORCH-03 |
| ORCH-013 | I auto | User has an uncommitted change in the project / unrelated file | Run blocked if HEAD dirty in owned paths; unrelated changes untouched after integration and merge | ORCH-03 |
| ORCH-014 | U auto | Adapter probe for a missing CLI (and Freebuff-like CLI without headless flag) | Status `UNSUPPORTED` / `UNAVAILABLE` with reason; never shown as connected; run cannot select it | ORCH-02 |
| ORCH-015 | U auto | Target path = IT Studio source repo / install dir | Run refused `TARGET_FORBIDDEN` | ORCH-03 |
| ORCH-016 | I auto | Run reaches the end | `AWAITING_APPROVAL`; no merge into target branch until `orch.approve`; then exactly one `--no-ff` merge | ORCH-03 |
| ORCH-017 | U auto | Token usage unknown from an adapter | Stored as `null`, cost `null`, UI shows "unknown"; never 0 | ORCH-03 |
| ORCH-018 | U auto | Settings → Orchestration save | Persists; "Saved" confirmation shown; invalid values rejected inline | ORCH-04 |
| ORCH-019 | E auto | Code → Orchestration with mock agents (E2E fixture) | Plan → start → live DAG → approve shows merged | ORCH-04 |
| ORCH-M01 | M manual | Real run with owner keys/subscriptions on a small repo | Evidence recorded in the run (agents really executed) | QA |
