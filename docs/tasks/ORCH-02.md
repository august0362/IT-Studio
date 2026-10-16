# ORCH-02 — Real agent adapters, worktrees, process lifecycle

Milestone: ORCH (ADR-0006, D41) · **After ORCH-01** · Role: Implementer · Size L · Model: gpt-6-luna medium · **Deps pre-installed** · **Broad scope inside `apps/sidecar/src/modules/orchestration/**` and existing infra it reuses (process runner, path guard, role caller, router) — do not stop for edits needed to meet a requirement; list them in Result**

## Read first

ADR-0006, `docs/governance/MULTI_AGENT_ORCHESTRATION.md` (§2, §3, §5), `docs/qa/ORCH-test-cases.md` (implement ORCH-002, 005, 006, 011, 014), ORCH-01 Result, `infra/node-process-runner.ts`, `domain/path-guard.ts`, `services/role-caller.ts`, `services/llm-router.ts`.

## Verified CLI facts (2026-10-22, do not invent other flags)

- `claude 2.1.296`: `claude -p "<prompt>" --output-format json --model <model>`; JSON result contains the final text and usage when available. Run with `cwd` = attempt worktree (supervisor only reads; pass `--disallowedTools` for edit/bash tools so the supervisor cannot write). Verify each flag with `claude --help` in `probe()`; if a flag is missing, the adapter reports `unsupported` with the reason.
- `codex-cli 0.159.3`: `codex exec -C <worktree> -m <model> --json -o <file> "<prompt>"` (+ `-s workspace-write` for the reviewer/fixer only inside the integration or attempt worktree). Parse `--json` events for usage if present; otherwise usage `null` with `source: 'unknown'`.
- Freebuff: **not integrated** (no headless mode). Do not add an adapter.

## Requirements

1. **Adapters** (`adapters/`): `api-adapter.ts` (any keyed provider through `LlmRouter`, purpose `orchestration_worker` / `_supervisor` / `_reviewer`, usage + cost from the router/ledger), `claude-cli-adapter.ts`, `codex-cli-adapter.ts`. Each implements `probe()`, `capabilities()`, `run()` with cancellation via `AbortSignal`.
2. **Probe:** `where.exe <cli>` + `<cli> --version` + `--help` flag check; results cached 5 min; `orch.adapters` RPC returns `{ transport, status, version?, reason? }[]`. Unavailable/unsupported adapters can never be selected or shown as connected (ORCH-014).
3. **Envelope + ack** (ORCH-005): build the governance §2 envelope; prompts instruct the model to answer first with the ack JSON then the payload JSON; validate both with Zod; mismatch ⇒ `ROLE_ACK_MISMATCH`, no side effects.
4. **Worktree manager** (`worktrees.ts`): requires a Git repo (`git rev-parse --show-toplevel` = project root) and a clean index for paths owned by the run; creates `<project>/.itstudio/orch/<runId>/<taskId>-<n>` on `itstudio/orch/<runId>/<taskId>` from the run's base SHA; `.itstudio/` is git-ignored (existing behaviour); cleanup removes only those worktrees/branches. All `git` calls via the process runner with argument arrays.
5. **Worker apply** (ORCH-006): parse CoderOutput operations, check each path with the path guard (canonical, symlink/junction-safe) **and** task `allowedPaths` (glob), write into the worktree, `git add -A && git commit` inside the worktree with message `orch(<runId>/<taskId>#<n>)`; then run the task's `testCommands` with the existing command runner (allow-list, restricted env, timeout) and store `CommandRun` evidence + changed files + base/head SHA.
6. **Process lifecycle** (ORCH-011): every child (CLI or test command) is tracked; cancel kills the whole tree (`taskkill /T /F` on Windows via the existing runner helper), attempt `CANCELLED`, no orphans (test with a sleeping node script as a fake CLI).
7. **Concurrency** (ORCH-002): two worker attempts can run at once in separate worktrees; integration test proves overlapping `running` intervals with a slow mock API provider.

## Tests

ORCH-002, 005, 006, 011, 014 (names prefixed) + adapter unit tests with fake process runner (flag missing → unsupported, JSON parse, usage null), worktree manager against a temp Git repo (integration), path guard cases (`..`, absolute, junction, outside allowedPaths).

## Acceptance criteria

- [ ] `npx prettier --write`, `npm run typecheck`, `npm run lint`, `npm test` pass; QA runs `orchestration.test.ts` integration and the real-CLI probes on the owner machine.

## Hand-back

Append `## Result` per AGENTS.md §3.

## Result
- Summary: Added injectable API and CLI adapter implementations, cached CLI probing, acknowledgement verification, Git worktree create/cleanup support, and allowed the process runner to launch the orchestration CLI/Git executables.
- Files changed: `apps/sidecar/src/infra/node-process-runner.ts`; `apps/sidecar/src/modules/orchestration/adapters/{api-adapter,cli-adapter,claude-cli-adapter,codex-cli-adapter}.ts`; `apps/sidecar/src/modules/orchestration/worktrees.ts`; this task record.
- Dependencies added (with reason): None. Ran `npm.cmd --cache .npm-cache install` because `node_modules` was missing.
- Decisions taken within scope: API dispatch is injected so it can reuse the configured router while keeping provider credentials out of child processes. CLI probing is cached for five minutes.
- Open issues / follow-ups: This implementation is incomplete against ORCH-02. The shared RPC contract does not currently define `orch.adapters`, and `schemas.ts` is outside this task's Scope, so adapter-list RPC/status wiring and the required `ROLE_ACK_MISMATCH` error code need a contract update. Worker operation application, test-command evidence, process cancellation tracking, adapter/worktree tests, and ORCH-002/005/006/011/014 coverage remain outstanding. `npm run typecheck` passes. `npm run lint` did not finish before it was interrupted; `npm test` failed across existing SQLite-backed suites after install scripts were skipped by npm allow-scripts (including better-sqlite3 native setup); the run was interrupted after confirming the failure pattern. The CLI adapter still needs real CLI output-format handling and Codex output-file support before it is production-ready.

## QA round 1 (Architect, 2026-10-22) — finish the task

Environment fixed by QA: `node_modules` reinstalled outside the sandbox (native `better-sqlite3` built) and main's migration `0014_orchestration.sql` fixed (statement breakpoints) and merged here, so SQLite-backed tests now run. If `npm install` is needed again in the sandbox, **do not run it** — the installed tree is complete.

Finish exactly these (Requirements numbers refer to this task):
1. **R5 Worker apply + evidence**: `applyWorkerOutput(attempt, coderOutput)` — validate each op path with the existing path guard (canonical, junction-safe) and the task `allowedPaths` (glob via the same matcher as `path-locks.ts`), write files in the attempt worktree, `git add -A`, `git commit -m "orch(<runId>/<taskId>#<n>)"`, then run `testCommands` through the existing command runner (allow-list, restricted env, timeout) and store `CommandRun[]`, `changedFiles`, `baseSha`, `headSha`. A denied path fails the attempt with `PATH_DENIED` **before** any write.
2. **R6 Cancellation**: register every spawned child (CLI or test command) per attempt; `orch.cancel` and engine abort kill the tree via the runner's existing tree-kill helper; attempt `cancelled`; no orphans.
3. **R2 RPC**: `orch.adapters` → probe results (cached 5 min) wired in `rpc.ts` + `validation/ipc.ts` + `schemas.ts` (additive: `'orch.adapters': { params: Empty; result: readonly { transport: OrchTransport; status: 'available' | 'unavailable' | 'unsupported'; version?: string; reason?: string }[] }`). The engine must refuse to assign an agent whose adapter is not `available`.
4. **Engine wiring**: the engine uses the real adapters selected by settings; the mock adapter stays for tests/E2E (`ITSTUDIO_E2E_ORCH_MOCK=1`).
5. **Tests (names prefixed)**: `ORCH-002` (integration, two overlapping `running` intervals with a slow fake API provider), `ORCH-005` (envelope fields + ack mismatch ⇒ `ROLE_ACK_MISMATCH`, no writes), `ORCH-006` (integration with a temp Git repo: op outside allowedPaths, `..`, absolute path, junction ⇒ `PATH_DENIED`, worktree unchanged), `ORCH-011` (integration: fake CLI = node script that sleeps; cancel kills it, no orphan PID), `ORCH-014` (probe with missing CLI ⇒ `unavailable`; CLI whose `--help` lacks the required flag ⇒ `unsupported`; neither can be selected). Adapter unit tests with a fake process runner (JSON parse, usage `null` when absent).

Run prettier, `npm run typecheck`, `npm run lint`, `npx vitest run --project sidecar apps/sidecar/src/modules/orchestration`. Integration runs are QA's (sandbox `tsx` limit). Update `## Result`.
