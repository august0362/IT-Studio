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

## Result
- Summary: Added scripted fake image-provider outcomes gated by `ITSTUDIO_E2E=1`; automated M8 integration and L4 image cases; verified existing path and asset-protocol protections.
- Files changed: `apps/sidecar/src/container.ts`, `apps/sidecar/src/infra/fake-image-provider.ts`, `apps/sidecar/src/services/image-service.test.ts`, `apps/sidecar/test/integration/harness.ts`, `apps/sidecar/test/integration/images.test.ts`, `e2e/wdio.conf.ts`, `e2e/specs/m8/images.spec.ts`.
- Dependencies added (with reason): None.
- Decisions taken within scope: `ITSTUDIO_E2E_IMAGE_SCRIPT` is JSON keyed by image provider ID with scripted `success` or `http:<status>` outcomes. The fake image providers only replace real providers when `ITSTUDIO_E2E=1`.
- Case -> file -> status:

  | Case | File | Status |
  |---|---|---|
  | TC-M8-001 | `apps/sidecar/test/integration/images.test.ts` | Covered; existing case retained |
  | TC-M8-002 | `apps/sidecar/test/integration/images.test.ts` | Covered; existing case retained |
  | TC-M8-003 | `apps/sidecar/test/integration/images.test.ts` | Added scripted provider fallback coverage |
  | TC-M8-004 | `apps/sidecar/test/integration/images.test.ts` | Added disabled forged-tool rejection coverage |
  | TC-M8-005 | `apps/sidecar/src/services/image-service.test.ts`, `apps/sidecar/test/integration/images.test.ts` | Verified generated asset paths are ID-based, not prompt-based |
  | TC-M8-006 | `apps/sidecar/test/integration/images.test.ts` | Added delete, file removal, and append-only ledger coverage |
  | TC-M8-007 | `apps/desktop/src/features/gallery/asset-protocol.test.tsx` | Existing test verified; outside task scope |
  | TC-M8-010 | `e2e/specs/m8/images.spec.ts` | Added chat image and lightbox E2E |
  | TC-M8-011 | `e2e/specs/m8/images.spec.ts` | Added Gallery prompt, cost, and confirmed delete E2E |
  | TC-M8-012 | `e2e/specs/m8/images.spec.ts` | Added settings persistence and keyboard reorder E2E |

- Open issues / follow-ups: `npm run typecheck`, `npm run lint`, and `npm test` pass. `npm run test:integration` could not run in this sandbox because spawned `tsx` processes fail in `node:os.userInfo()` with `uv_os_get_passwd returned ENOMEM`; the same failure affects all integration suites. E2E was not run as instructed; QA should run the integration and M8 E2E cases. `npm install` added no dependencies; it reported 29 existing audit advisories.

## QA (Claude) — state at hand-off (2026-10-04, owner-requested stop)
- Merged `main` (resolved `e2e/wdio.conf.ts`: kept `./specs/m8/images.spec.ts` and `./specs/mw/workflow.spec.ts`, `shutdown.spec.ts` last).
- typecheck ✔, lint ✔, unit 860 ✔, integration **111/111 ✔** (TC-M8-001…006).
- E2E `e2e/specs/m8/images.spec.ts` **FAIL** (1 run, 43 s): `✖ TC-M8-010` — `waitUntil condition timed out after 5000ms` in `openImageSession` (`images.spec.ts:25`, called from line 97); reason `Cannot read properties of undefined (reading 'isDisplayed')`. The spec opens its own `remote({ port: 4449 })` session instead of the wdio `browser` session; not yet diagnosed.
- Next (fix round 1): use the standard `browser` session and pass `ITSTUDIO_E2E_IMAGE_SCRIPT` the way the m4 specs pass `ITSTUDIO_E2E_LLM_SCRIPT`, or fix the remote-session element handling and use a 30 s start-up timeout. Then rerun only this spec, write `docs/qa/M8-report.md`, land. See `docs/HANDOFF.md` §4.1.

## Result (QA continuation)
- Summary: Fixed the M8-010 Ready wait and dialog teardown; invalidated the image-list cache after chat completion so generated images render; added deterministic per-image pricing gated to E2E mode so TC-M8-011 can verify Gallery cost without changing real pricing seeds. The focused M8 spec passes all three cases.
- Files changed: `apps/desktop/src/features/chat/ChatPage.tsx`, `apps/sidecar/src/container.ts`, `e2e/specs/m8/images.spec.ts`, `e2e/wdio.conf.ts`, `docs/qa/M8-report.md`, `docs/tasks/M8-QA.md`.
- Dependencies added (with reason): None.
- Decisions taken within scope: Synthetic $1/image pricing is supplied only to the E2E sidecar through `ITSTUDIO_E2E_IMAGE_PRICE_MICRO_USD`; product seed data is unchanged. No commit, push, reset, merge, or worktree removal was performed.
- Case -> file -> status:

  | Case | File | Status |
  |---|---|---|
  | TC-M8-010 | `e2e/specs/m8/images.spec.ts` | Pass: image render, lightbox, and teardown |
  | TC-M8-011 | `e2e/specs/m8/images.spec.ts` | Pass: prompt, deterministic cost, and confirmed deletion |
  | TC-M8-012 | `e2e/specs/m8/images.spec.ts` | Pass: toggle persistence and provider reorder |

- Verification: `npx wdio run e2e/wdio.conf.ts --spec e2e/specs/m8/images.spec.ts --logLevel warn` — 3 passing; `npm run typecheck` passed; `npm test` passed (860 tests passed, 1 skipped, plus 6 script tests). The prior QA handoff records integration 111/111 passing; integration was not rerun in this continuation. See `docs/qa/M8-report.md`.
- Open issues / follow-ups: The complete E2E suite and integration suite were not run in this continuation. The QA handoff's 111/111 integration result remains the available evidence for TC-M8-001…006. The diagnostic directory `C:\Users\admin\AppData\Local\Temp\itstudio-e2e-zVHkUU` remains outside the worktree because the tool policy rejected recursive cleanup.

## Result (QA continuation 2)
- Summary: Re-ran the M8 image integration suite after the focused E2E fixes; all image integration cases passed.
- Files changed: `docs/tasks/M8-QA.md`.
- Dependencies added (with reason): None.
- Decisions taken within scope: Ran only the affected image integration file, not the full integration suite.
- Open issues / follow-ups: `npx vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/images.test.ts` passed (1 file, 5 tests). The E2E report records 3/3 cases passing; main branch integration still requires merging/reconciling the task worktree.
