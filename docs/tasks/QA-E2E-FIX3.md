# QA-E2E-FIX3 — Last attempt on the 8 remaining E2E cases (exact errors from the 2026-10-03 run)

Role: Implementer (ROLES §1.3) · Scope: `e2e/**` only · **Do not run E2E.** This is fix attempt 6 for this group (user rule: after 6 failed fixes the cases are skipped and reported) — use the exact errors below, read the component code for real labels/roles, do not guess.

| Case | Exact error | Fix |
|---|---|---|
| TC-M6-070/071/072 | pipeline ends `COMMAND_FAILED` | default `settings.pipeline.validationCommands` run **three** commands: `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/eslint/bin/eslint.js . --format json`, `node node_modules/vitest/vitest.mjs run --reporter=json` (see `config/commands.default.json`). The current shim creates only `tsc`. Create shims for **all three** paths in the temp project (`node_modules/eslint/bin/eslint.js` must print `[]` for json format; `vitest.mjs` must print a minimal JSON test summary the parser accepts — check `apps/sidecar/src/domain/parsers/{eslint,vitest}.ts`), each exiting 0 (pass case) or the vitest one exiting 1 (TC-M6-071 fail case). TC-M6-072 must cancel while VALIDATING: make the vitest shim sleep (e.g. 20 s) for that case. |
| TC-M4-031 | `expected 'Budget limit must be a positive USD d…' to include 'valid positive USD limit'` | assert the actual sidecar message (read it from `apps/sidecar/src/services/budget-guard.ts` / validation) — e.g. `include('positive USD')` |
| TC-M4-023 | `Can't call setValue on element "aria/Message" because element wasn't found` | after toggling Auto Fallback in Settings → Router, navigate back to Chat (`a[href="#chat"]`) and re-open the conversation before typing |
| TC-M4-043 | `invalid selector: An invalid or illegal selector was specified` | find the selector in the case (likely a non-CSS pseudo such as `:has-text` / unescaped `/` or `.` in an attribute) and replace with a valid CSS / `aria/…` / `button=…` selector |
| TC-M5-022 | same `invalid selector` | same as above |
| TC-M5-023 and M4 Settings `afterEach` | `element click intercepted … Other element would receive the click` (on `Add project`, on the `#settings-router` nav link) | a dialog / `ConfirmDialog` / popover from the failed step is still open and covers the page: in `afterEach` press Escape and wait until no `[role="dialog"],[role="alertdialog"]` is displayed before navigating; in TC-M5-023 close the citation popover before the next click |

Type-check and lint `e2e`; append `## Result` with case → change.
