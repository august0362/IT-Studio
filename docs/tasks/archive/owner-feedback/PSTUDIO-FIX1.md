# PSTUDIO-FIX1 — Accept a bare TaskSpec from the PM (regression from PSTUDIO-01)

Milestone: v1 add-on · Role: Implementer (ROLES §1.3) · Size S · **Deps pre-installed**

## Problem

After PSTUDIO-01 the PM output must be `{ kind: 'spec', spec } | { kind: 'questions', questions }`. Scripted fixtures (integration `apps/sidecar/test/integration/{pipeline,workflow,vscode-bridge}.test.ts`, E2E) and real models that ignore the envelope return a **bare `TaskSpec`** object. Such runs now fail at SPECIFYING: on `main`, `npx vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/pipeline` fails 10+ cases (timeouts, `expected 'failed' to be 'rolled_back'`), and `break-security` BRK-S03 times out.

## Scope

- `apps/sidecar/src/services/role-caller.ts` (+ its test)
- `apps/sidecar/src/validation/pipeline.ts` (+ its test) only if the PM output schema lives there
- This task file (`## Result`)

## Requirements

1. PM output parsing accepts, in this order: the `{ kind: 'spec' }` envelope, the `{ kind: 'questions' }` envelope (first call only), **or a bare object that validates as `TaskSpec`** → treated exactly as `{ kind: 'spec', spec }`. Anything else → existing invalid-output handling.
2. The second PM call (after answers) also accepts a bare `TaskSpec`.
3. Do not change test fixtures; the existing integration tests must pass unchanged.

## Tests

Unit: bare TaskSpec on first and second call → spec; envelope variants unchanged; garbage → invalid.
QA (outside sandbox, record if the sandbox blocks it): `npx vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/` — all green.

## Acceptance criteria

- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Hand-back

Append `## Result` per AGENTS.md §3.

## Result

- Summary: PM parsing now tries the existing envelopes first, then validates a bare `TaskSpec` and returns `{ kind: 'spec', spec }`. This works before and after clarification answers and preserves existing invalid-output retries. Added six regression cases covering both calls, envelope precedence, garbage, and invalid spec paths; replaced the obsolete bare-spec rejection case with an invalid field type.
- Files changed: `apps/sidecar/src/services/role-caller.ts`, `apps/sidecar/src/services/role-caller.test.ts`, `docs/tasks/PSTUDIO-FIX1.md`. Integration fixtures, shared contracts, manifests, and lockfile are unchanged.
- Dependencies added (with reason): None. Restored the existing dependencies with `npm.cmd --cache .npm-cache install` because `node_modules` was missing. Used `npm.cmd` because PowerShell blocks `npm.ps1`.
- Decisions taken within scope: Reuse `taskSpecSchema` only after envelope validation fails; retain the existing prompt schemas and validation error details. No changes to `validation/pipeline.ts` were needed.
- Verification: Prettier on the changed paths, `npm.cmd --cache .npm-cache run typecheck`, `npm.cmd --cache .npm-cache run lint`, and `git diff --check` passed. All 33 role-caller unit tests passed. The separately invoked build/release Node tests passed (15 tests).
- Open issues / follow-ups: `npm.cmd --cache .npm-cache test` stopped in pretest: four secret-scanner regression tests require empty stderr, but Git reports permission denied for `C:\Users\admin/.config/git/ignore`. Ran the underlying Vitest suite separately: 1,099 passed, one skipped, one failed (`TC-MW-009` in `apps/desktop/src/features/chat/ChatPage.test.tsx`, missing the selected-conversation heading); rerunning that file alone passed all four tests. The unchanged integration suite was attempted with `npm.cmd --cache .npm-cache exec -- vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/`: all 115 tests failed because the sidecar cannot start (`tsx` calls `os.userInfo()`, which fails with `uv_os_get_passwd` / `ENOMEM`; one bridge case timed out waiting for startup). This is the documented sandbox limitation; QA must rerun integration and the full default suite outside the sandbox. No tooling changes or commits were made.
- Changelog draft: Accept bare PM TaskSpec responses before and after clarification answers, preserving envelope priority and validation retries (PSTUDIO-FIX1).
