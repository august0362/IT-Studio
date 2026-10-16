# ORCH-04 — Orchestration UI: Code tab view, Settings section, Processes hooks

Milestone: ORCH (ADR-0006, D41) · **After ORCH-03** · Role: Implementer · Size M–L · Model: gpt-6-luna medium · **Deps pre-installed** · **Broad scope inside `apps/desktop/src/**`, settings contracts/validation for the orchestration settings (additive) — list cross-module edits in Result**

## Read first

ADR-0006 §9, governance §6 (runbook), `docs/qa/ORCH-test-cases.md` (ORCH-018, ORCH-019), `features/code/**`, `features/settings/**` (Settings page + search index), `features/processes/**`, theme primitives (`components/ui/{PageHeader,EmptyState,Icon,primitives}`).

## Requirements

1. **Settings → Orchestration** (new section in the Settings page + search index entries en/vi):
   - Role assignment: supervisor, worker A, worker B and reviewer. Each picks an agent = transport + model, from available adapters/models only.
   - A live adapter status list from `orch.adapters`: Available / Unavailable / Unsupported, with the reason and version.
   - Limits: max cost (USD; VND shown beside it via the existing money display), wall clock (min), agent calls, concurrent workers (1–4, default 2), fix rounds (0–3), transient retries (0–2), Hard Stop toggle.
   - **Save** shows a visible "Saved / Đã lưu" confirmation (toast or inline). Invalid values show inline errors and are not saved (ORCH-018).
   - Settings contract additive: `orchestration: { roles: { supervisor, workerA, workerB, reviewer: OrchAgentRef }, limits: OrchLimits }`, normalised for old settings.
2. **Code → Orchestration view** (tab next to the existing pipeline view):
   - Request box → **Plan** (calls `orch.plan`, shows a spinner and the supervisor's DAG as a graph using the process viewer graph component, plus a task table: title, deps, allowedPaths, candidate agents, estimate).
   - **Start**, **Cancel**, **Resume**, and **Approve merge** / **Discard** in `AWAITING_APPROVAL` (with an integration diff viewer and evidence list).
   - Live updates from `orch.event`: per task, the state chip, assigned agent (agent · model · transport), branch/worktree, fix rounds, last reason.
   - Per attempt: role, agent, duration, usage. Unknown values are shown as "unknown", never 0. Also cost, diff and test evidence.
   - Run header: state, cost vs limit, calls vs limit, elapsed vs limit; a pause reason banner with the action to raise the limit or resume.
   - Disabled with a clear message when the project is not a Git repo or adapters for the required roles are unavailable.
3. **Projects page:** show an "Active orchestration" badge per project with a running/paused run.
4. **Processes:** `orchestration` kind rows link to the Code → Orchestration view of that run; the viewer renders tasks as modules (already published by ORCH-01).
5. i18n en + vi for every string; theme tokens only; accessible labels; reduced motion respected.

## Tests

ORCH-018 (settings save/validation/"Saved"), ORCH-019 (E2E with mock adapters via an E2E fixture env flag `ITSTUDIO_E2E_ORCH_MOCK=1` that registers the mock adapter as available), RTL for plan → start → live updates → approve, unknown usage rendering, disabled states.

## Acceptance criteria

- [ ] `npx prettier --write`, `npm run typecheck`, `npm run lint`, `npm test` pass; QA runs the new E2E spec and takes mock screenshots.

## Hand-back

Append `## Result` per AGENTS.md §3.
