# M4-QA — Automate the M4 test-case specification

Milestone: M4 · Role: Implementer (ROLES §1.3) · **Deps pre-installed**

## Read first
- `AGENTS.md`, `TESTING.md`, **`docs/qa/M4-test-cases.md`** (your work order), `apps/desktop/src/**`, `e2e/**`

## Scope
- Tests: `apps/desktop/src/**/*.test.{ts,tsx}`, `e2e/specs/m4/**`, `e2e/helpers/**`, `e2e/wdio.conf.ts` (per-spec env for scripted LLM / per-model scripts, see TC-M4-022/023), `apps/desktop/src/i18n/{en,vi}.json` (remove unused keys only). Other QA tasks edit sidecar tests in parallel — do not touch them.
- Production code only if a new test exposes a defect — fix minimally, list under *Decisions*.

## Requirements
1. Implement every case marked **new**, complete **verify** items, fix the flaky TC-M4-004 timeout; case ID in the test name.
2. Write all L4 cases (WebdriverIO) but **do not run E2E** — QA runs them in one batched session with the user's permission.
3. If a per-model LLM script is needed for E2E (fallback badge / modal), wire it through the existing `ITSTUDIO_E2E_LLM_SCRIPT` env and a fixture under `e2e/fixtures/**`, set per spec without restarting other specs' drivers.
4. Measure and report the §2 targets.

## Acceptance criteria
- [x] `npm run typecheck && npm run lint && npm test` exit 0; `npm run vite:build -w @itstudio/desktop` succeeds; targets reported

## Hand-back
Append `## Result` per AGENTS.md §3 including a table: case ID → test file → status.

## Result
- Summary: Added the M4 component/static checks and authored the new WebdriverIO cases. Set the ESLint theme rule test timeout to 60 seconds and removed the unused budget translation key from both locales. E2E cases were not run, as requested.
- Files changed: `apps/desktop/src/theme/theme.test.tsx`, `apps/desktop/src/i18n/en.json`, `apps/desktop/src/i18n/vi.json`, `e2e/specs/m4/{chat,cost,settings,shell,theme,scripted-llm}.spec.ts`, `e2e/fixtures/{m4-slow-chat,m4-fallback}.json`, `e2e/wdio.conf.ts`, `docs/tasks/M4-QA.md`.
- Dependencies added (with reason): None. Installed existing lockfile dependencies because `node_modules` was absent.
- Decisions taken within scope: Slow-stream and fallback cases use dedicated scripted `tauri-driver` instances with distinct fixture paths and data directories; the default and other spec drivers are not restarted. Per-model scripts use model IDs from `config/models.seed.json`.
- Open issues / follow-ups: Desktop-only coverage measured 70.12% lines, below the §2 target of 80%; the scoped coverage run also reported 68.63% statements, 57.37% branches, and 63.56% functions. `SafeMarkdown.tsx` measured 100% lines / 90% branches. The coverage command exited 1 on configured global thresholds. The production main JS chunk measured 1,125.96 kB (<1.5 MB). QA must execute the authored E2E cases in the batched window session; this run intentionally did not execute them.

| Case ID | Test file | Status |
|---|---|---|
| TC-M4-001 | `e2e/specs/m4/theme.spec.ts` | Authored; E2E not run |
| TC-M4-002 | `e2e/specs/m4/theme.spec.ts` | Authored 36-pair smoke; E2E not run |
| TC-M4-003 | `apps/desktop/src/theme/ThemeSync.test.tsx` | Existing verify case; included in passing unit suite |
| TC-M4-004 | `apps/desktop/src/theme/theme.test.tsx` | Timeout set to 60 seconds; included in passing unit suite |
| TC-M4-010 | `e2e/specs/m4/shell.spec.ts` | Existing; E2E not run |
| TC-M4-011 | `e2e/specs/m4/shell.spec.ts` | Existing; E2E not run |
| TC-M4-012 | `e2e/specs/m4/shell.spec.ts` | Authored; E2E not run |
| TC-M4-013 | `e2e/specs/m4/shell.spec.ts` | Authored; E2E not run |
| TC-M4-014 | `apps/desktop/src/theme/theme.test.tsx` | Authored; unit suite passed |
| TC-M4-020 | `e2e/specs/m4/chat.spec.ts` | Existing; E2E not run |
| TC-M4-021 | `e2e/specs/m4/scripted-llm.spec.ts` | Authored with slow-stream fixture; E2E not run |
| TC-M4-022 | `e2e/specs/m4/scripted-llm.spec.ts` | Authored with per-model fallback fixture; E2E not run |
| TC-M4-023 | `e2e/specs/m4/scripted-llm.spec.ts` | Authored with per-model fallback fixture; E2E not run |
| TC-M4-024 | `apps/desktop/src/components/SafeMarkdown.test.tsx` | Existing full corpus verify; unit suite passed |
| TC-M4-025 | `e2e/specs/m4/chat.spec.ts` | Authored; E2E not run |
| TC-M4-030 | `e2e/specs/m4/cost.spec.ts` | Existing; E2E not run |
| TC-M4-031 | `e2e/specs/m4/cost.spec.ts` | Authored; E2E not run |
| TC-M4-032 | `e2e/specs/m4/cost.spec.ts` | Authored; E2E not run |
| TC-M4-033 | `e2e/specs/m4/cost.spec.ts` | Authored; E2E not run |
| TC-M4-034 | `apps/desktop/src/theme/theme.test.tsx` | Authored; unit suite passed |
| TC-M4-040 | `e2e/specs/m4/settings.spec.ts` | Existing; E2E not run |
| TC-M4-041 | `e2e/specs/m4/settings.spec.ts` | Authored; E2E not run |
| TC-M4-042 | `e2e/specs/m4/settings.spec.ts` | Authored; E2E not run |
| TC-M4-043 | `e2e/specs/m4/settings.spec.ts` | Authored; E2E not run |
| TC-M4-044 | `e2e/specs/m4/settings.spec.ts` | Authored; E2E not run |
| TC-M4-045 | `e2e/specs/m4/settings.spec.ts` | Authored; E2E not run |
| TC-M4-046 | `e2e/specs/m1/api-keys.spec.ts` | Existing TC-M1-030 write-only key check; unit/UI case retained |
| TC-M4-050 | `e2e/specs/m4/shell.spec.ts` | Authored; E2E not run |
| TC-M4-051 | `e2e/specs/m4/shell.spec.ts` | Authored; E2E not run |

## QA (Claude) — round 1
- Work reviewed: E2E cases authored (not run), flaky theme lint test timeout fixed, unused i18n key removed.
- **Fix round 1 required — desktop coverage 70.1 % lines (target ≥ 80 %, §2):** add component tests (fake RPC client, Testing Library) for the least-covered desktop files first (list them from the coverage report: `npx vitest run apps/desktop --coverage`), prioritising user flows: settings pages (router / budget / pricing / fx / vscode / pipeline), cost page sub-components, knowledge page, code page panels, shell (`AppShell`, `ProjectTabs`, `NewProjectDialog`). Target ≥ 80 % lines and ≥ 70 % branches for `apps/desktop/src/**`; report before/after per file. Tests only — production code only if a test exposes a defect. Do not run E2E.

## Result (fix round 1)
- Summary: Added 16 component tests using the fake RPC transport for settings, cost, knowledge, code panels, and shell behavior. Desktop source coverage is now 85.56% lines and 70.44% branches, above the round target. No production code changed.
- Files changed: `apps/desktop/src/features/round1-coverage.test.tsx`, `docs/tasks/M4-QA.md`.
- Dependencies added (with reason): None.
- Decisions taken within scope: Kept the coverage tests in a single feature test file to share one RPC test harness; all test responses are local and deterministic.
- Open issues / follow-ups: `npm --cache .npm-cache exec -- vitest run apps/desktop --coverage` runs desktop tests but applies the root coverage thresholds to all workspaces, so the command exits 1 for unselected sidecar/vscode-ext files (0% in this desktop-only run). The desktop-only metrics meet the requested targets. E2E was not run.

| Case / file | Before this fix | After this fix |
|---|---:|---:|
| Desktop overall lines / branches | 70.12% / 57.37% | 85.56% / 70.44% |
| `features/settings/pipeline/PipelineSettingsPage.tsx` lines / branches | 67.85% / 53.12% | 96.42% / 88.23% |
| `features/cost/BudgetBars.tsx` lines / branches | 85.00% / 7.14% | 90.00% / 78.57% |
| `features/cost/BreakdownCharts.tsx` lines / branches | 71.42% / 16.66% | 100% / 100% |
| `features/cost/PortfolioPage.tsx` lines / branches | 0% / 0% | 100% / 100% |
- Verification: `npm --cache .npm-cache run typecheck`, `npm --cache .npm-cache run lint`, and `npm --cache .npm-cache test` passed; 685 passed, 1 skipped. `npm --cache .npm-cache run vite:build -w @itstudio/desktop` passed (main chunk 1,125.96 kB). No E2E command was run.

## QA (Claude) — round 2
- Coverage target met (85.6 % lines). After merging main: typecheck ✔, lint ✔, build ✔, integration 98/98 ✔; unit 753/754 — `TC-M4-R1-004` fails on this machine and passes in the sandbox.
- **Defect BUG-M4-001 (S3):** UI formats numbers and dates with the **OS locale** (`Intl.NumberFormat(undefined, …)`, `toLocaleString()`, `toLocaleDateString()`) instead of the app's selected i18n locale (`en` / `vi`). An English UI on Vietnamese Windows shows `25.000`; tests are machine-dependent. Occurrences: `features/settings/fx/FxSettingsPage.tsx` (rate + asOf), `features/settings/pricing/PricingSettingsPage.tsx` (Δ %), `features/cost/LedgerTable.tsx`, `features/cost/RevenueForm.tsx`, `features/settings/api-keys/ApiKeysPage.tsx`.
- **Fix round 2 required:**
  1. Add `apps/desktop/src/i18n/format.ts` (pure, 100 % branches): `formatNumber(value, locale, options)`, `formatDateTime(iso, locale)`, `formatDate(iso, locale)` mapping app locale `en` → `en-US`, `vi` → `vi-VN`; components take the locale from `i18n.language`.
  2. Replace every OS-locale call in `apps/desktop/src/**` (non-test) with these helpers; add a static test that fails on `Intl.NumberFormat(undefined`, `.toLocaleString()` and `.toLocaleDateString()` without an explicit locale in `apps/desktop/src/**`.
  3. Make `TC-M4-R1-004` deterministic (assert the en-US and vi-VN renderings explicitly). Money stays `MoneyDisplay` from the sidecar — untouched.
  4. Do not run E2E.

## Result (fix round 2)
- Summary: Added locale-aware number/date helpers mapping English to `en-US` and Vietnamese to `vi-VN`, replaced OS-locale formatting in desktop UI, added pure formatter and static regression tests, and made the FX test assert both locale renderings.
- Files changed: `apps/desktop/src/i18n/format.ts`, `apps/desktop/src/i18n/format.test.tsx`, `apps/desktop/src/features/settings/fx/FxSettingsPage.tsx`, `apps/desktop/src/features/settings/pricing/PricingSettingsPage.tsx`, `apps/desktop/src/features/cost/LedgerTable.tsx`, `apps/desktop/src/features/cost/RevenueForm.tsx`, `apps/desktop/src/features/settings/api-keys/ApiKeysPage.tsx`, `apps/desktop/src/features/knowledge/DocumentTable.tsx`, `apps/desktop/src/features/round1-coverage.test.tsx`, `docs/tasks/M4-QA.md`.
- Dependencies added (with reason): None.
- Decisions taken within scope: Unknown locale tags fall back to `en-US`; date helpers preserve the user's local time zone while applying the selected app locale. Money formatting remains in the sidecar.
- Open issues / follow-ups: None. E2E was not run as requested.
- Verification: `npm --cache .npm-cache run typecheck`, `npm --cache .npm-cache run lint`, and `npm --cache .npm-cache test` passed; 757 passed, 1 skipped. No E2E command was run.

| Case ID | Test file | Status |
|---|---|---|
| TC-M4-R1-004 | `apps/desktop/src/features/round1-coverage.test.tsx` | Pass; asserts explicit en-US and vi-VN FX number renderings |
| TC-M4-R2-001 | `apps/desktop/src/i18n/format.test.tsx` | Pass; formatter coverage and static OS-locale regression check |

## QA (Claude) — final
- Verdict: **PASS (L4 pending)**. Round 1 raised desktop coverage 70.1 % → 85.6 % lines (70.4 % branches; tests sit in one `round1-coverage.test.tsx` — split per feature later). Round 2 fixed BUG-M4-001 (S3: numbers/dates followed the OS locale instead of the app locale; 6 places) with `i18n/format.ts` + a static guard. After merging main: typecheck ✔, lint ✔, unit 757/757 ×2, `vite:build` ✔, integration 98/98 (before round 2, desktop-only change since). L4 cases run in the batched E2E session.
