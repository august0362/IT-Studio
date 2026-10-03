# M8-QA — Automate the M8 test-case specification

Role: Implementer (ROLES §1.3) · **Deps pre-installed**

## Read first
`AGENTS.md`, `TESTING.md`, **`docs/qa/M8-test-cases.md`**, `apps/sidecar/test/integration/images.test.ts`, the E2E harness (`e2e/**`, scripted sessions in `scripted-llm.spec.ts`).

## Scope
Tests and test harness only: `apps/sidecar/src/**/*.test.ts` (image), `apps/sidecar/test/integration/images.test.ts`, the `ITSTUDIO_E2E=1` fake image provider (add scripted outcomes via `ITSTUDIO_E2E_IMAGE_SCRIPT`, gated on `ITSTUDIO_E2E=1`), `e2e/specs/m8/**` + registration in `e2e/wdio.conf.ts` before `shutdown.spec.ts`. Product code only if a test proves a defect (fix minimally, list it).

## Requirements
Implement every **new** case and the **verify** items; case ID in the test name. L4 specs must be self-contained (own project, own settings restore in `afterEach`, dialogs closed). Do not run E2E (QA runs it right after).

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0; QA runs integration + the M8 E2E spec.

## Hand-back
Append `## Result` per AGENTS.md §3 with a case → file → status table.
