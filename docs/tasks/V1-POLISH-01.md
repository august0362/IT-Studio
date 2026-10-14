# V1-POLISH-01 — Close the open v1 S3 observations and build hygiene

Milestone: v1 polish (after the M9 sign-off) · Role: Implementer (ROLES §1.3) · Size M · **Deps pre-installed**

## Goal

Fix the S3 observations left open by the M9 exploratory session (`docs/qa/M9-report.md`, *Open observations*) and the HANDOFF backlog items below. First reproduce each one on current `main` with a failing test; OWNER-FB1 may already have fixed some. If an item is already fixed, add the regression test only and say so in `## Result`.

## Read first

`AGENTS.md`, `CONTEXT.md` D9, D32, `docs/qa/M9-report.md` (M9-OBS-02…06), `apps/desktop/src/features/{cost,workflow,settings/pricing}/**`, `apps/sidecar/src/services/pricing-service.ts`, `scripts/build/{smoke-sidecar,make-icon,build-app}.mjs`.

## Scope — files you may create/modify

- `apps/desktop/src/features/cost/**` (+ tests)
- `apps/desktop/src/features/workflow/**` (+ tests)
- `apps/desktop/src/features/settings/pricing/**` (+ tests)
- `apps/sidecar/src/services/pricing-service.ts` and `apps/sidecar/src/infra/sqlite/price-table-repository.ts` if it exists (+ tests); no schema shape change, no migration
- `scripts/build/smoke-sidecar.mjs`, `scripts/build/make-icon.mjs`, `scripts/build/build-app.mjs` (+ a node test in `scripts/build/`)
- `apps/desktop/src/i18n/{en,vi}.json` (only keys for these fixes)
- This task file (`## Result`)

## Requirements

1. **M9-OBS-06:** in the All-projects Cost view, "Top spend by project" shows the project **name**, falling back to a short id only if the project no longer exists.
2. **M9-OBS-02:** setting a manual price on one model changes the Origin label of that row only; clearing it restores the row's previous origin label (seed, fetched or verified). Other rows never change label.
3. **Backlog "pricing override after restart":** clearing a manual override after an app restart restores the last **fetched or verified** price for that model, not the seed price. Persist what is needed inside the existing price-table JSON (as OWNER-FB1 did for provenance); no migration.
4. **M9-OBS-03:** the Workflow graph's initial viewport and the Fit View button show every node fully at 1 280×800 and 1 580×1 000 (test the layout bounds / `fitView` options).
5. **M9-OBS-05:** a module whose last in-flight call completed (including a zero-hit retrieval) is no longer shown as Active; the node, the *Now* panel and *Recent* agree after each event.
6. **M9-OBS-04:** `smoke-sidecar.mjs` runs 1 warm-up start and then 3 measured starts, and passes when the median is below 1 500 ms. It prints every timing, including the cold one.
7. **Build hygiene:** `make-icon.mjs` must not leave tracked icon files modified when the source icon is unchanged. Regenerate into a temporary directory, compare the bytes of the PNG/ICO, and only copy changed files. `icon.icns` from `tauri icon` is not deterministic, so keep the committed `icon.icns` unless the source SVG changed (compare a hash of the SVG stored next to the icons). After `npm run build:app`, `git status` shows no changes under `apps/desktop/src-tauri/icons/`.

## Tests

One regression test per requirement (component tests for 1, 2, 4, 5; service tests for 2, 3; node tests for 6, 7).

## Acceptance criteria

- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint` and `npm test` pass. QA runs integration, the affected E2E specs (`m4/cost`, `m4/settings`, `mw/workflow`) and `npm run smoke:sidecar`.

## Hand-back

Append `## Result` per AGENTS.md §3.
