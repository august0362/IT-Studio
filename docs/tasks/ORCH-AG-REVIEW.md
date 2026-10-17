# ORCH-AG-REVIEW — Codex review of Antigravity's ORCH-AG implementation

Role: Reviewer / fixer (governance §1). Model: gpt-6-luna medium. Worktree: this folder (branch `task/ORCH-AG`). Never commit, push or reset; never run npm install.

## Do

1. Read `docs/tasks/ORCH-AG.md` (requirements A–D and its `## Result`), `docs/governance/MULTI_AGENT_ORCHESTRATION.md`, `docs/qa/ORCH-test-cases.md`.
2. Review the diff `git diff 3a60b3d..HEAD -- . ':!docs'` (Antigravity's changes) for: each requirement actually implemented (not only tested), concurrency correctness of the pool in `engine.ts` (shared counters, limit checks before every call, no lost results on `Promise.race`, cancellation aborts every in-flight attempt), git calls use argument arrays and stay in the `itstudio/orch/*` namespace, `orch.approve` merges only when the touched paths are clean and never pushes, unknown usage stays `null`, `TARGET_FORBIDDEN` uses canonical paths, recovery never relaunches automatically, tests assert real behaviour (no tautologies, each ORCH id tests what `ORCH-test-cases.md` says).
3. Fix every defect you find (within `apps/sidecar/src/modules/orchestration/**`, `apps/sidecar/test/integration/orchestration.test.ts`, additive contract fixes in `src/types/schemas.ts` / `validation/**`). Do not lower acceptance criteria.
4. Run `npx prettier --write` on changed files, `npm run typecheck`, `npm run lint`, `npx vitest run --project sidecar apps/sidecar/src/modules/orchestration`.
5. Append `## Review verdict` to this file: `PASS` or `FIX_REQUIRED`, a findings table (severity, file:line, issue, fixed? yes/no), the list of fixes you made, and the command results.

## Review verdict

**PASS**

| Severity | File:line | Issue | Fixed? |
|---|---|---|---|
| High | `apps/sidecar/src/modules/orchestration/engine.ts:232` | Concurrent pipelines checked the call budget before awaiting worktree preparation but only incremented the shared call counter afterward, allowing multiple attempts to pass the same remaining slot. | yes |
| Medium | `apps/sidecar/src/modules/orchestration/engine.ts:554` | Worker selection paused on the first unavailable candidate instead of probing the remaining eligible candidates. | yes |
| High | `apps/sidecar/src/modules/orchestration/engine.ts:680` | A failed or timed-out integration validation could still proceed to final review and owner approval. | yes |

Fixes made:
- Reserved agent-call capacity before asynchronous worktree preparation and released the reservation if preparation fails.
- Probed all eligible worker candidates and assigned the first available one; added an ORCH-014 regression test.
- Paused with `INTEGRATION_VALIDATION_FAILED` and skipped final review when integration validation fails or times out.

Command results:
- `npx.cmd prettier --write apps/sidecar/src/modules/orchestration/engine.ts apps/sidecar/src/modules/orchestration/engine.test.ts` — passed.
- `npm.cmd --cache .npm-cache run typecheck` — passed.
- `npm.cmd --cache .npm-cache run lint` — passed (Git emitted a user-level ignore-file permission warning).
- `npx.cmd vitest run --project sidecar apps/sidecar/src/modules/orchestration` — passed, 22 tests.
- `npx.cmd vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/orchestration` — passed, 3 tests.
