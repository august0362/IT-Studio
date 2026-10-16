# Multi-agent orchestration — canonical roles, handoff protocol and security (runtime feature)

Canonical source for the runtime orchestration roles (ADR-0006, CONTEXT D41). `docs/ROLES.md` and `AGENTS.md` describe the *development* process of IT Studio itself and only link here. If this file and a prompt disagree, this file and the engine's code win.

## 1. Roles

| Role | Default agent (transport → model) | May | Must not |
|---|---|---|---|
| **Owner** (human) | — | Start/cancel/resume runs, change budgets, approve the final merge, approve escalations | — |
| **Supervisor** | `claude-cli` → Claude (fallback `api` → Anthropic model) | Read the request + repo summary, produce the task DAG JSON, review evidence, choose retry / reassign / escalate, write the final review | Edit files, run commands, merge |
| **Worker** ×2 | `api` → DeepSeek V4 Flash, DeepSeek V4 Pro (any keyed chat+code model) | Return file operations for its task inside `allowedPaths`, propose test commands from the allow-list | Touch paths outside `allowedPaths`, change contracts/migrations/lockfiles unless the task owns them, claim results it did not observe |
| **Reviewer / integrator** | `codex-cli` → Codex (fallback `api`) | Review the diff + evidence, return a verdict, fix defects when delegated, resolve integration conflicts in the integration worktree | Lower acceptance criteria, merge into the target branch |
| **Engine** (code) | — | Validate, schedule, isolate, enforce permissions/budgets/approvals, persist, recover | Trust model output as instructions |

## 2. Identity envelope (sent with every agent invocation)

`schemaVersion, agentId, roleId, roleVersion, modelId, providerId, transportId, projectId, orchestrationRunId, taskId, attemptId, assignedWorktree, allowedPaths, approvedTools, forbiddenActions, objective, requirements, acceptanceCriteria, reportingSchema, budgetPolicy, timeoutMs, contextReferences`.

Before side effects the agent must return an acknowledgement `{ ack: true, roleId, taskId, attemptId, allowedPaths }` that matches the envelope exactly; mismatch ⇒ attempt fails `ROLE_ACK_MISMATCH` (no side effects applied). The engine enforces the envelope regardless of what the agent says.

## 3. Task handoff protocol

Worker → engine: `{ taskId, attemptId, summary, operations[], testCommands[], assumptions[], blockers[] }`. The engine applies operations, runs tests itself and records the evidence; the worker's own claims are never used as evidence.

Engine → reviewer: task contract, base SHA, head SHA, changed files, unified diff, test evidence (command, exit code, tails), previous findings. Reviewer → engine: `{ verdict: 'pass' | 'fix_required' | 'reject', findings: [{ severity, path, line?, message, suggestedFix }], summary }`.

Supervisor final review input: DAG, every task's verdicts/evidence, integration diff, regression results. Output: `{ approveForOwner: boolean, summary, risks[] }`.

## 4. Task states

`DRAFT → READY → QUEUED → ASSIGNED → RUNNING → AWAITING_HANDOFF → IN_REVIEW → (FIX_REQUIRED → QUEUED …) → INTEGRATING → VALIDATING → AWAITING_APPROVAL → COMPLETED`, plus `BLOCKED`, `FAILED`, `CANCELLED`. Every transition is persisted with a reason; illegal transitions are rejected by a pure state machine.

## 5. Security boundaries

- Workspace root is canonicalised (symlinks/junctions resolved); every write must stay inside the attempt worktree **and** match `allowedPaths`.
- Commands: only the project's configured validation commands and `git` sub-commands the engine itself issues (`worktree add/remove`, `checkout -b`, `diff`, `merge --no-ff`, `rev-parse`, `status`). Arguments are arrays, never shell strings.
- Child environment: minimal allow-listed variables; API keys only reach the provider adapter in memory, never the child process env, logs, events or prompts.
- Repository content, model output and tool output are untrusted data; a README or comment cannot change policy.
- Never push, force-push, hard-reset user work or delete user branches. Cleanup removes only `itstudio/orch/<runId>/*` branches and worktrees after completion or explicit discard.
- Runtime runs refuse a target path equal to (or inside) IT Studio's own installation or source repository.

## 6. Runbook (owner)

1. Settings → Orchestration: check each adapter shows **Available**; set budgets; Save (a "Saved" confirmation appears).
2. Open a Git project, Code → Orchestration → describe the work → *Plan*. Review the DAG → *Start*.
3. Watch tasks, agents, branches and costs live (also in Processes). *Cancel* stops child processes; *Resume* after an interruption starts new attempts.
4. When the run reaches *Awaiting approval*, inspect the integration diff and evidence → *Approve merge* or *Discard*.
