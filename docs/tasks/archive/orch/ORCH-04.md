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
- Open issues / follow-ups: The task contract does not expose Git-repository status, integration diff contents, selected branch, or formatted USD/VND `MoneyDisplay`, so the UI cannot pre-disable non-Git projects, render an integration diff, or show the required dual-currency limit display yet. Adapter probing is currently a placeholder and reports API available statically. ORCH-03 currently returns errors for approve/discard; the full ORCH-019 approve-and-merge E2E remains dependent on that work and is not included here. The workspace test suite's Node tests have one unrelated existing failure (`REPO-01` stale `../../../TESTING.md` reference); the normal `npm test` pretest also fails in this sandbox because Git cannot read `C:\Users\admin/.config/git/ignore`.
- Verification: `npm run typecheck` passed. `npm run lint` passed (Git emitted the user ignore-file permission warning). Focused desktop tests passed (40/40). `npm run test --ignore-scripts` passed all Vitest suites (1,613 passed, 1 skipped) but its Node script suite had the unrelated REPO-01 failure described above. `npm test` was attempted and stopped in `lint:selftest` on the Git ignore-file permission warning.

## Result

- Summary: Owner-requested UX follow-up (2026-10-20): RPC failures display ordered remediation below the message; reviewer attempts display verdict, summary and findings with severity, location and suggested fixes. Attempts also display state/reason and labelled changed files; missing usage/cost remains unknown.
- Files changed: `apps/desktop/src/features/code/OrchestrationCodeView.tsx`, its new component test, `apps/desktop/src/i18n/en.json`, `apps/desktop/src/i18n/vi.json`, this task record.
- Dependencies added (with reason): None.
- Decisions taken within scope: Reused `RpcCallError.appError`, shared attempt contracts and `SafeMarkdown`; query and notification-refresh failures also display remediation. Known zero usage/cost remains zero.
- Open issues / follow-ups: Live DAG refresh and the real mock-agent ORCH-019 E2E are the next owner-requested task. Full-suite load caused timeouts in M9-OBS-02, M9-OBS-05 and QA-BREAK-02-D04; all passed when rerun serially with the affected component tests.
- Verification: Typecheck and lint passed; focused desktop regression rerun passed 42/42 across four files; Node script tests passed 27/27. Full Vitest run: 1,659 passed, 3 timeout failures (resolved on the focused rerun), 1 skipped.

## Result

- Summary: Completed the owner-requested ORCH-019 mock-agent E2E (2026-10-20). Plan renders the DAG; process events update it while the view stays mounted; approval performs exactly one target-branch merge. Restored graph sizing/styles and six missing bilingual table headers. Marked ORCH-QA complete with the owner's existing ORCH-M01 real-run date.
- Files changed: `apps/desktop/src/features/code/OrchestrationCodeView.tsx` and its component test; `apps/desktop/src/i18n/{en,vi}.json`; `apps/sidecar/src/container.ts`; `e2e/wdio.conf.ts`; `e2e/specs/orch/orchestration.spec.ts`; `docs/ROADMAP.md`; this task record.
- Dependencies added (with reason): None.
- Decisions taken within scope: Reused the shared `useProcesses` event cache and process graph styles. Enabled mock agents only for the orchestration spec, with an E2E-only worker that writes a real fixture file. Selected WebDriver Classic after BiDi returned an empty `about:blank` document. The temporary Git repository owns its identity, hooks, line endings and `.gitignore`; the test verifies unchanged HEAD/no target file before approval, a two-parent merge, unchanged original content, clean status and worktree/branch cleanup afterwards. Shutdown remains the last registered spec. No real agents or paid APIs were run.
- Open issues / follow-ups: Full integration completed with 174 passed, 2 failed, 1 skipped (25 files). The known QA-BREAK-02-D07 BRK-C12 failure was `AssertionError: expected 235.0893999999971 to be less than 200`. TC-M2-009 failed with `Test timed out in 20000ms`, then passed when rerun alone (1 passed, 17 filtered out). No changes were made to those tests or their unrelated modules. MOD/LLMPOOL work remains deferred until the owner explicitly says go.
- Verification: Prettier, typecheck and lint passed; affected desktop/orchestration unit tests passed 70/70 in 12 files; off-screen ORCH-019 passed 1/1. Screenshots: `C:/Users/admin/AppData/Local/Temp/itstudio-e2e-evidence-4r8Mcu/ORCH-019-{plan-ready,awaiting-approval,merged}.png`.
