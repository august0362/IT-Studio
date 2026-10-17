# ORCH-AG-REVIEW — Codex review of Antigravity's ORCH-AG implementation

Role: Reviewer / fixer (governance §1). Model: gpt-6-luna medium. Worktree: this folder (branch `task/ORCH-AG`). Never commit, push or reset; never run npm install.

## Do

1. Read `docs/tasks/ORCH-AG.md` (requirements A–D and its `## Result`), `docs/governance/MULTI_AGENT_ORCHESTRATION.md`, `docs/qa/ORCH-test-cases.md`.
2. Review the diff `git diff 3a60b3d..HEAD -- . ':!docs'` (Antigravity's changes) for: each requirement actually implemented (not only tested), concurrency correctness of the pool in `engine.ts` (shared counters, limit checks before every call, no lost results on `Promise.race`, cancellation aborts every in-flight attempt), git calls use argument arrays and stay in the `itstudio/orch/*` namespace, `orch.approve` merges only when the touched paths are clean and never pushes, unknown usage stays `null`, `TARGET_FORBIDDEN` uses canonical paths, recovery never relaunches automatically, tests assert real behaviour (no tautologies, each ORCH id tests what `ORCH-test-cases.md` says).
3. Fix every defect you find (within `apps/sidecar/src/modules/orchestration/**`, `apps/sidecar/test/integration/orchestration.test.ts`, additive contract fixes in `src/types/schemas.ts` / `validation/**`). Do not lower acceptance criteria.
4. Run `npx prettier --write` on changed files, `npm run typecheck`, `npm run lint`, `npx vitest run --project sidecar apps/sidecar/src/modules/orchestration`.
5. Append `## Review verdict` to this file: `PASS` or `FIX_REQUIRED`, a findings table (severity, file:line, issue, fixed? yes/no), the list of fixes you made, and the command results.
