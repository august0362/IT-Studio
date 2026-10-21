# 06 — Final report (stabilization pass, 2026-10-20 … 21)

Branch `stabilization/v1-hardening` (from `95dd972`), pushed to `origin`; **not merged into `main`** — merging is the
owner's decision. Work done directly by Claude (owner rule since 2026-10-20: no Codex or other agents unless asked).

## Verdict

| Status | Value | Basis |
|---|---|---|
| **ENGINEERING_VERIFIED** | **Yes**, for the scope of this pass and within the limits of `03-VERIFICATION.md` §4 | CI `39473302355` green on `e20eb35`; local integration and E2E evidence in `03-VERIFICATION.md` §3 |
| **OWNER_ACCEPTED** | **No** — 13/40 checklist cases accepted earlier (16/10 build); 27 + 6 new orchestration cases not run | `04-OWNER-ACCEPTANCE.md` |
| **RELEASE_READY** | **No** | needs owner acceptance, `main` protection, merge of this branch, a new installer build + install smoke |

## 1. Completed

| Task | What | Evidence |
|---|---|---|
| P0-01 / STAB-D01 | One segment-based glob matcher; nested `src/**` paths work; unsafe paths never match | `02-DEFECTS.md`, `glob.test.ts`, reliability `P0-01` |
| P0-02 / STAB-D02 | Strict final-review gate (`approveForOwner: true` only) | `final-review.test.ts` |
| P1-01 / STAB-D03 | Startup sweep, attempts persisted before side effects, resume from persisted attempts, serialized sessions | `recovery.test.ts`, reliability `P1-01` (9 crash/resume scenarios) |
| P1-02 / STAB-D04 | Real Git conflict resolution through an engine-controlled journaled write; otherwise abort + pause | reliability `P1-02` |
| P1-03 / STAB-D05 | Approval merges the reviewed SHA only on the unchanged target; stale → pause → re-integrate + re-review; merge failures aborted; serialized; completion before cleanup | reliability `P1-03` |
| STAB-D08 (found by CI) | Real-path comparison of project roots (8.3, junctions) in orchestration and Knowledge | `workspace.test.ts` CI-01, `discover-files.test.ts` CI-02 |
| OBS-03 | Discard for paused / interrupted runs in the UI | `OrchestrationCodeView.test.tsx` |
| Phase C | Vietnamese owner acceptance guide with honest statuses; disposable test project script | `04-OWNER-ACCEPTANCE.md`, `scripts/dev/acceptance-fixture.mjs` |
| Phase D | CI workflow (4 required-ready jobs); ruleset JSON ready | `05-CI-GOVERNANCE.md` |
| Phase E | ARCH §8.3, ADR-0006 date correction + amendments, CONTEXT D41 note, ROADMAP progress fix + STAB section, HANDOFF TL;DR/roles, RUNNING status, TESTING §9, CHANGELOG | this branch |

## 2. Partially completed / blocked

| Item | State | Owner action |
|---|---|---|
| `main` branch protection | **Blocked** — no authenticated GitHub admin access in this session; nothing configured or claimed | `gh auth login` (then Claude applies `.github/rulesets/main-protection.json` and verifies a rejected direct push), or import the ruleset in GitHub *Settings → Rules* |
| Owner acceptance | Not run (human cases) | follow `04-OWNER-ACCEPTANCE.md` |
| Real-adapter validation | Not run in this pass (no real agents/providers called) | owner cases ORCH-R1…R6 |
| Installer | Not rebuilt; the 2026-10-17 installer lacks these fixes | `npm run build:app` + `npm run smoke:install` after merge |

## 3. Files modified (by area)

- Orchestration (`apps/sidecar/src/modules/orchestration/`): new `glob.ts`, `recovery.ts`, `final-review.test.ts`,
  `glob.test.ts`, `recovery.test.ts`; changed `engine.ts`, `orchestration-module.ts`, `workspace.ts`, `worktrees.ts`,
  `prompts.ts`, `dag.ts`, `path-locks.ts`, `run-machine.ts` and their tests.
- `apps/sidecar/src/container.ts` (startup sweep), `src/types/schemas.ts` (`OrchRun.baseSha`, `integrationBaseSha`,
  `integrationHeadSha` — additive, optional).
- Knowledge: `services/discover-files.ts` (+ test).
- Desktop: `OrchestrationCodeView.tsx` (+ test), `src/test-setup.ts` (async util timeout).
- Tests: `apps/sidecar/test/integration/orchestration-reliability.test.ts` (new, 20 cases),
  `orchestration.test.ts` (mock supervisors approve).
- Tooling: `.github/workflows/ci.yml`, `.github/rulesets/main-protection.json`, `scripts/dev/acceptance-fixture.mjs`
  (+ test).
- Docs: `docs/qa/stabilization/01…06`, `../../ARCHITECTURE.md`, `../../CONTEXT.md`, `../../ROADMAP.md`, `../../HANDOFF.md`, `../../RUNNING.md`,
  `../../TESTING.md`, ADR-0006, `CHANGELOG.md`.

## 4. Test results

| Gate | Result |
|---|---|
| CI on `e20eb35` (typecheck, lint, format, secret scan, unit, integration, builds, sidecar smoke) | **pass** — run `39473302355` |
| Unit (local, before the last two commits) | 1 747 passed, 1 skipped (baseline 1 678 + 1 skipped) |
| Integration (local, all 26 files) | 191 passed, 1 skipped, 5 failed — BRK-C12 and 4 router timeouts under load; the router file passes alone, also on baseline |
| New regression tests | unit: glob 46, final review 14, recovery 6, prompts 1, workspace 2, discovery 1, UI 2; node: fixture 2; integration: 20 (real Git + SQLite) |
| E2E ORCH-019 (off-screen) | pass |
| Machine-sensitive cases on CI | BRK-C12, BRK-D07 fail on the hosted runner — non-blocking job, documented in `05-CI-GOVERNANCE.md` §4 |
| Not run | full E2E suite, `build:app`, `smoke:install`, real-provider smoke, owner acceptance |

## 5. Remaining risks

1. **Owner acceptance not done**: human-only checks (real keys, UI, VS Code, installer) are unverified on this branch.
2. **Real agents unverified after the fixes**: the strict final-review schema means a real supervisor that answers in
   another shape now pauses the run (safe, but it may surface as "FINAL_REVIEW_INVALID" until prompts settle).
3. **Dependent tasks start from the run base** (OBS-01): a task cannot build on its dependency's code; conflicts appear
   only at integration (now handled safely, but each costs a reviewer call or pauses the run).
4. **Lost cost of an interrupted call**: the provider may have charged a call whose result was never saved; the run
   total does not include it (the ledger may).
5. **Timing-sensitive integration/UI tests** on slower machines (BRK-C12 and similar) — see `05-CI-GOVERNANCE.md` §4.
6. **`main` unprotected** until the owner applies the ruleset.

## 6. Recommended next steps

1. Owner: review the branch (or open a PR from `stabilization/v1-hardening`), apply branch protection, run the
   acceptance guide with the disposable project.
2. After acceptance: merge via PR (CI green), rebuild the installer, run `smoke:install`, update `V1-report.md`.
3. Then, on the owner's go-ahead only: OBS-01 decision (dependent task bases), OBS-02 (run-level evidence),
   LLMPOOL-01/02. (GitHub Actions are SHA-pinned since 2026-10-21.)
