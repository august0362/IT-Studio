# PROC-01T — Fix two process integration tests (test-only)

Milestone: PROC (D40) · Role: Implementer · Size XS · **Deps pre-installed** · Test-only, no product change.

## Problem (QA 2026-10-16, after PROC-01 landed)

`apps/sidecar/test/integration/processes.test.ts`:

1. **TC-PROC-002** expects a failing chat to end `stopped`, but OWNER-FB2-A makes chat *Auto* append every other keyed, enabled chat model, so another scripted model answers and the process ends `ended`. Make **every** Auto candidate fail in this test (script all keyed models to the same failure, or disable the others via settings before sending), so the chat really fails → `stopped` → retry.
2. **TC-PROC-003** calls `process.cancel` on the retried process right after `process.retry`, but the scripted reply completes first, so cancel hits an ended process and returns an error. Use the existing slow scripted chat fixture (`e2e/fixtures/m4-slow-chat.json` approach / a delayed scripted response) for the retried call, wait until the retried process is `running`, then cancel and assert `stopped`.

## Scope

`apps/sidecar/test/integration/processes.test.ts` (and helpers in the same folder if needed). This task file (`## Result`).

## Acceptance criteria

- [ ] `npx vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/processes` passes (QA runs it outside the sandbox); typecheck + lint pass.

## Result

- Summary: Script both keyed Google chat models with identical outcomes so TC-PROC-002 exhausts Auto candidates before stopping. In TC-PROC-003, restore the in-memory provider key after restart so the reloaded delayed script remains active for retry; wait for running before cancellation and verify stopped afterward.
- Files changed: `apps/sidecar/test/integration/processes.test.ts`, `docs/tasks/PROC-01T.md`.
- Dependencies added (with reason): None. Restored the missing `node_modules` using `npm.cmd --cache .npm-cache install`; dependency manifests and lockfile are unchanged.
- Decisions taken within scope: Reuse the existing `delay:30000` scripted response, whose cursor resets on sidecar restart. Only Google is keyed by this test setup, so both seeded Google chat models receive the same script.
- Validation: Prettier run on both changed files; `npm.cmd --cache .npm-cache run typecheck` and `npm.cmd --cache .npm-cache run lint` passed. Lint emitted the Git global-ignore permission warning described below but exited successfully.
- Open issues / follow-ups: QA must rerun the focused integration suite outside the sandbox: all three cases fail before `system.ready` because tsx calls `os.userInfo()` and receives `uv_os_get_passwd` / `ENOMEM`, a documented sandbox limitation. `npm.cmd --cache .npm-cache test` stops in pretest: four secret-scanner regression cases reject Git stderr warning that `C:/Users/admin/.config/git/ignore` is inaccessible; the main test suite therefore did not run. No tooling workaround was applied. `docs/qa/PROC-test-cases.md` is absent; this test-only fix follows the existing TC-PROC-001/002/003 tests and this task's two specified corrections.
