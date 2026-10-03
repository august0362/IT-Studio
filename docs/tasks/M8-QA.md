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
