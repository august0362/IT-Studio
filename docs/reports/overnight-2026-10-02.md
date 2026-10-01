# Overnight report — 2026-10-02

> Autonomous run while the user sleeps. Updated after every task. Newest entries at the bottom of each section.

## Summary
- Status: running
- Tasks completed tonight: —
- Tasks failed / rolled back: —

## Completed

| Task | Result | Commit |
|---|---|---|
| M0-04 Monorepo scaffold | PASS (QA re-ran 3 sandbox-blocked checks) | f95cd23 |
| M0-05 Lint gate | PASS | ef39833 |
| M0-06 Test gate (Vitest) | PASS (Architect fixed 1-line ESLint config blocker) | 7935165 |
| M1-04 UI RpcClient + hooks | PASS | see git log |
| M1-01 zod validators + seed loader (closes M0-07) | PASS (QA ran Prettier) | 2762857 |
| M2-06 Router state machine | PASS | see git log |
| M2-01 Provider port + contract suite | PASS | see git log |
| M1-02 Sidecar RPC core | PASS (live ping verified) | 878b2c7 |
| M3-01 Cost & money domain | PASS | see git log |
| M1-05 SQLite + settings/projects | PASS (QA regenerated migrations, added 1 test) | see git log |
| M1-03 Rust sidecar supervisor | PASS after 1 fix round (app could never exit — fixed) | ea0f6e4 |

## Failed / rolled back (needs your attention)

*(none)*

## Decisions taken with defaults (please review)

| Ref | Decision | Where |
|---|---|---|
| ENV-1 | Codex sandbox (Windows, `sandbox="elevated"`) could not write into the repo on the Desktop path; 5 ACL fixes failed (all reverted — repo permissions are back to original). **Solution (attempt 6): every Codex task now runs in its own git worktree under `C:\Users\admin\itstudio-wt\<ID>`**, which the sandbox can write; Claude merges the branch after QA (`scripts/dev/run-task.sh`, `land-task.sh`). Sandbox stays ON. Bonus: parallel tasks are fully isolated. | AGENTS.md §5 |
| D17 | Theme system designed per your request: 18 themes (19 palettes, 1 duplicate) × light/dark, color-psychology metadata, all pairs pass WCAG (text 7:1). Review the catalog in docs/design/THEMES.md §4 — rename or re-describe any theme you like. | docs/design/THEMES.md |
| ENV-2 | Two Codex runs hung for 60 min waiting on stdin (`codex exec` reads stdin when not a TTY). Fixed runner with `< /dev/null`; reruns started. Codex reasoning effort set to `high` (was `xhigh`) for faster, cheaper runs; override with `CODEX_EFFORT=xhigh`. | scripts/dev/run-task.sh |
| PROC-1 | New rule from user: any error surviving 6 fix attempts → skip + report, or stop session. | ROLES §1.2 |

## Needs you in the morning

- Run `npm run dev` once to visually confirm the Tauri window opens (cannot be verified headlessly).
