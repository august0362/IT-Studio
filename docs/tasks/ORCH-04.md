# ORCH-04 — Orchestration UI: Code tab view, Settings section, Processes hooks

Milestone: ORCH (ADR-0006, D41) · **Runs in parallel with ORCH-02/03** — if `orch.adapters` is not in `schemas.ts` yet, add exactly: `'orch.adapters': { params: Empty; result: readonly { readonly transport: OrchTransport; readonly status: 'available' | 'unavailable' | 'unsupported'; readonly version?: string; readonly reason?: string }[] }` (+ its `validation/ipc.ts` entries); approve/discard may return errors until ORCH-03 lands — handle them in the UI · Role: Implementer · Size M–L · Model: gpt-6-luna medium · **Deps pre-installed** · **Broad scope inside `apps/desktop/src/**`, settings contracts/validation for the orchestration settings (additive) — list cross-module edits in Result**

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

## Result
- Summary: Added orchestration settings contracts/defaults/validation, adapter status RPC, bilingual Settings controls and search entries, Code orchestration tab with planning/actions/live run and attempt details, process graph/deep links, and active project badges. Added ORCH-018 settings UI coverage.
- Files changed: `src/types/schemas.ts`; sidecar orchestration settings defaults, validation, RPC registration, settings merge, and a settings fixture; desktop Code, Settings, Projects, process navigation, i18n, and their focused tests; this task file.
- Dependencies added (with reason): None. Installed the pinned workspace dependencies with `npm --cache .npm-cache install` because `node_modules` was absent.
- Decisions taken within scope: Orchestration settings updates are atomic at the orchestration object level. Model selectors use enabled code-capable models. The mock adapter reports available only when `ITSTUDIO_E2E_ORCH_MOCK=1`.
- Open issues / follow-ups: The task contract does not expose Git-repository status, integration diff contents, selected branch, or formatted USD/VND `MoneyDisplay`, so the UI cannot pre-disable non-Git projects, render an integration diff, or show the required dual-currency limit display yet. Adapter probing is currently a placeholder and reports API available statically. ORCH-03 currently returns errors for approve/discard; the full ORCH-019 approve-and-merge E2E remains dependent on that work and is not included here. The workspace test suite's Node tests have one unrelated existing failure (`REPO-01` stale `docs/TESTING.md` reference); the normal `npm test` pretest also fails in this sandbox because Git cannot read `C:\Users\admin/.config/git/ignore`.
- Verification: `npm run typecheck` passed. `npm run lint` passed (Git emitted the user ignore-file permission warning). Focused desktop tests passed (40/40). `npm run test --ignore-scripts` passed all Vitest suites (1,613 passed, 1 skipped) but its Node script suite had the unrelated REPO-01 failure described above. `npm test` was attempted and stopped in `lint:selftest` on the Git ignore-file permission warning.
