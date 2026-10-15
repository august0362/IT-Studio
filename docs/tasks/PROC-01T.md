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
