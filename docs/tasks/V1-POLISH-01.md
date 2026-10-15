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
- `apps/sidecar/src/services/pricing-service.ts` and `apps/sidecar/src/infra/sqlite/price-repository.ts` and `apps/sidecar/src/ports/price-repository.ts` (scope amendment 2026-10-15: the price-table file does not exist) (+ tests); no schema shape change, no migration
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

## Result

- Summary: implemented project-name rankings with a short-id fallback, persistent automatic price backups behind manual overrides, consistent Workflow lifecycle display and fit options, a cold warm-up plus three median-gated smoke starts, and byte-comparing icon generation. M9-OBS-02 was already fixed by OWNER-FB1; added component regressions for setting/clearing seed and fetched row origins and service regressions for fetched/verified provenance. The user approved the two additional price-repository paths on 2026-10-15. No commits made.
- Files changed: `features/cost/PortfolioPage.tsx` and its new test; `features/settings/pricing/PricingSettingsPage.test.tsx`; Workflow `activity.ts`, `workflow-store.ts`, `workflow-store.test.tsx`, `ModulePanel.tsx`, `WorkflowPage.tsx`, `WorkflowPage.test.tsx`, `WorkflowGraph.tsx`, `WorkflowGraph.test.tsx`, and `layout.ts`; sidecar `services/pricing-service.ts` and its tests, `ports/price-repository.ts`, and `infra/sqlite/price-repository.ts` and its new test; `scripts/build/{smoke-sidecar,make-icon,polish.test}.mjs`; this task file. Desktop feature paths above are under `apps/desktop/src/` and sidecar paths under `apps/sidecar/src/`.
- Dependencies added (with reason): none. `node_modules` was present on this resumed run. Package manifests, lockfile, shared schemas and migrations are unchanged.
- Decisions taken within scope: store optional, validated `automaticEntries` in the existing price-table JSON and keep it off the RPC contract. Persist updates even while an override hides them; repeated manual edits retain the automatic backup. Legacy JSON without backups remains readable. Workflow pairs anonymous lifecycle events FIFO within each project/module, deduplicates notifications and repeated request starts, and uses recent activity to reconcile active snapshots. Initial fitting waits for measured nodes; initial and control fitting share a 0.1 minimum zoom and padding. Icon hashes live beside the icons at `icons/.npm-cache/source.svg.sha256` (already gitignored); a source hash in the script bootstraps fresh checkouts without replacing the committed nondeterministic ICNS.
- Verification: formatted changed files using `npm.cmd --cache .npm-cache exec -- prettier --write ...`; `npm.cmd --cache .npm-cache run typecheck` and `npm.cmd --cache .npm-cache run lint` passed. All 65 focused tests in 10 files passed, as did all 17 build/release Node tests. Pre-fix regressions reproduced the project label, restart backup, viewport, and retrieval-state defects (7 failures); the pricing label component regressions passed before implementation. Real `node scripts/build/make-icon.mjs` succeeded, and `git status --short -- apps/desktop/src-tauri/icons` was empty afterward. Evidence is in `.npm-cache/polish-{before,targeted-final,typecheck,lint,test,rerun,build-app}.log`.
- Open issues / follow-ups: the full `npm test` run reached 1,157 passing / 6 failing / 1 skipped Vitest cases. Five timing-sensitive failures all passed in the isolated rerun (60/60); the deterministic remaining failure is `TC-M4-R1-014` in out-of-scope `apps/desktop/src/features/round1-coverage.test.tsx:375`, whose `getByText('Alpha')` now matches both the project table and the corrected ranking. Requested approval to replace only that assertion with checks for both visible occurrences; the file is untouched pending approval. The original pretest also encountered sandbox access denial for Git's optional global ignore file; a process-local appended Git configuration pointing that optional file to an empty `.npm-cache` file lets all secret-scanner self-tests pass while retaining the harness safe-directory settings. `npm.cmd --cache .npm-cache run build:app` could not pass esbuild's sandbox directory access check (`Cannot read directory "../..": Access is denied`); tooling was not changed. QA must rerun the full build, integration, the affected E2E suites and real SEA smoke outside the sandbox. Overrides already stored by older versions without backup metadata retain the legacy seed fallback.
- CHANGELOG draft for the Architect: Fix portfolio project labels, retain automatic pricing behind overrides across restarts, reconcile Workflow activity and viewport fitting, and avoid icon churn while measuring median sidecar startup ([V1-POLISH-01](V1-POLISH-01.md)).
