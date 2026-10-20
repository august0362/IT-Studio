# 03 — Verification (stabilization pass)

Environment for local runs: Windows 11, Node 24.19.0, Git 2.54.0, this owner machine, no other job running unless
noted. CI runs: GitHub Actions `windows-latest` (see `05-CI-GOVERNANCE.md`). Logs of local runs were kept in the
session scratch directory (not committed); counts below are copied from them.

Status vocabulary: **ENGINEERING_VERIFIED** (automated evidence on the stated commit) · **OWNER_ACCEPTED** (only by
the owner, `04-OWNER-ACCEPTANCE.md`) · **RELEASE_READY** (`06-FINAL-REPORT.md`). Mock agents prove engine
behaviour, not model quality; no real provider or CLI agent was called in this pass.

## 1. Before / after evidence per defect

"Before" = the new regression tests copied into a detached worktree of `95dd972` (`C:/Users/admin/itstudio-wt/
stab-baseline`, `node_modules` junctioned) and run there.

| Defect | Regression tests | Before (`95dd972`) | After |
|---|---|---|---|
| STAB-D01 glob | `glob.test.ts` (46), reliability `P0-01` (2) | 12/46 failed; 2/2 failed (`Worker output contains a path outside the task allowance`) | all pass |
| STAB-D02 final review | `final-review.test.ts` (14), `prompts.test.ts` | 12/14 failed (`expected 'awaiting_approval' to be 'paused'`) | all pass |
| STAB-D03 recovery | `recovery.test.ts` (6), reliability `P1-01` (9) | new API absent; with the legacy `start()` sweep 7/8 failed (task stays `running`, resume → `paused`/`failed`, two concurrent resumes both run) | all pass |
| STAB-D04 conflicts | reliability `P1-02` (4) | 4/4 failed (textual pass reaches `awaiting_approval`, unmerged entries left) | all pass |
| STAB-D05 approval | reliability `P1-03` (6) | 4/6 failed (stale approval merged, `MERGE_HEAD` left in the owner's repo, no reviewed SHA, no `CLEANUP_INCOMPLETE`) | all pass |
| STAB-D08 real paths | `workspace.test.ts` `CI-01` (2), `discover-files.test.ts` `CI-02` (1) | 3/3 failed | all pass; orchestration unit 105/105 and integration 23/23 also with an 8.3 `TEMP` |

Existing tests changed (no assertion removed): `engine.test.ts` fixtures get a supervisor that approves; ORCH-014
expects the final-review call; ORCH-008 counts reviewer calls only; `prompts.test.ts` expects the new prompt kinds;
`orchestration.test.ts` (integration) mock supervisors approve the final review; `TC-M5-033` injects its `readdir`
failure one call later; `OrchestrationCodeView.test.tsx` adds Discard for `paused`/`paused_interrupted`.

## 2. Gate runs

| # | Commit | Command | Env | Exit | Result |
|---|---|---|---|---|---|
| B1 | `95dd972` | `npm run typecheck` | local | 0 | pass |
| B2 | `95dd972` | `npm run lint` | local | 0 | pass |
| B3 | `95dd972` | `npm test` | local | 0 | 1 678 passed, 1 skipped; node 27/27 |
| B4 | `95dd972` | `npm run test:integration` | local | stopped | 2/25 files run: 3 timing failures (BRK-C01, BRK-C12, TC-M2-010) |
| G1 | working tree before `0151bcf` | `npm run typecheck`, `npm run lint`, `npm test` | local | 0 / 0 / 0 | unit 1 747 passed, 1 skipped; node 29/29 |
| G2 | `0151bcf` | integration `orchestration.test.ts` + `orchestration-reliability.test.ts` | local | 0 | 23/23 |
| CI1 | `ec27caa` | CI run `39451656683` | GitHub | failure | static ✓, build+smoke ✓; unit ✗ (2, 8.3 paths); integration ✗ (8.3 paths + timing) → STAB-D08 |
| CI2 | `2c63e6b` | CI run `39470943728` | GitHub | see §3 | static ✓, build+smoke ✓, unit ✗ (1 UI timing flake: `WorkflowPage` M9-OBS-05 `findByLabelText` 1 s) |
| L1 | working tree after `2c63e6b` | `vitest --project desktop` with `asyncUtilTimeout` 5 s | local | 0 | 412/412 |

## 3. Final gate

Filled in at the end of the pass (`06-FINAL-REPORT.md` repeats the verdict).

## 4. Coverage limitations

- No real LLM provider, `claude` or `codex` CLI was invoked (owner rule: no real agents without a request). Real-adapter
  behaviour is owner acceptance case ORCH-R1…R6.
- Crash recovery is tested by abandoning an engine at a chosen await point and opening a second module instance on the
  same SQLite file; a real process kill of the sidecar during orchestration is covered only by the owner case R6.
- Windows only; the product and the SEA build are Windows-only.
- E2E (WebdriverIO + tauri-driver) runs locally, not in CI (needs the matching Edge WebDriver and a desktop session).
