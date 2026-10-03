# QA-E2E-FIX1 — Fix the E2E specs authored blind in M4/M5/M6/M7-QA

Role: Implementer (ROLES §1.3) · **Deps pre-installed** · Source: QA batched E2E session 2026-10-03 (2 full runs, 18 min each).

## Result of the session
Passing (keep untouched): TC-M1-001/004/007/030/035/040/041, TC-M4-001/002/010/011/012/013/020/030/050, TC-M5-021.
Failing (both runs unless noted):

| Case | Spec:line | Symptom | Root cause (QA) |
|---|---|---|---|
| TC-M4-025, TC-M4-033, TC-M4-042, TC-M4-051, TC-M5-020/022/023, TC-M6-070/071/072 | chat:66, cost:83, settings:54, shell:123, knowledge:21/46/63, code:19/33/43 | wait for reply / document / "Completed" times out | **No provider keys in that WebDriver session.** Each spec file starts a fresh app whose secret store is in-memory (`ITSTUDIO_E2E=1`); only `chat.spec.ts` TC-M4-020 stores a dummy key. Chat, embeddings and pipeline roles all hit `capability_mismatch`. |
| TC-M4-040, TC-M4-042 | settings:9/54 | `label*=Auto Fallback input` / `label*=Hard Stop input` not found | Invalid selector combination. The checkbox is inside a `<label>` with text from i18n `settings.router.autoFallback` / `settings.budget.hardStop` (see `RouterSettingsPage.tsx:129-136`, `BudgetSettingsPage.tsx:16-21`) — select by accessible name (`aria/Auto Fallback`) or `label=…` then `.$('input')`. |
| TC-M4-041 | settings:32 | announcement not found | Announcement text is i18n `settings.router.dragEnd` = `Moved {{name}} before {{target}}.` (with a trailing period) rendered in dnd-kit's live region; read the live region (`[role="status"]` / `#DndLiveRegion-*`) instead of `body` text, and verify the persisted order via the list after reload. |
| TC-M4-031 | cost:37 | `$12.50` never shown | Check the budget bar text format in `features/cost/BudgetBars.tsx` and assert on what the component renders for limit 12 500 000 µUSD (sidecar `MoneyDisplay`); also needs the active project selected. |
| TC-M4-032 | cost:64 | table starts with "Chat E2E Project" | All spec files share **one data dir per run**, so projects from earlier specs are present. Use unique project names (suffix with a run nonce) and assert only the relative order / totals of the test's own projects. |
| TC-M4-022, TC-M4-023 | scripted-llm:83/97 | badge not shown / Auto Fallback selector | Same selector fix as TC-M4-040; ensure the scripted driver's session also stores keys for both models' providers. |
| TC-M1-006 (run 2 only), TC-M4-021 (run 2 only) | shutdown / chat | process remained; slow-stream timing | The extra scripted `tauri-driver` instances added in M4-QA may leave `itstudio-desktop.exe` processes running when their sessions end, so the final shutdown check sees a desktop process. Ensure every scripted session is deleted in `after`, kill any desktop process started by those drivers in `onComplete`/`afterSession`, and make `waitForShutdown` consider only the PID tree of the session under test. |

## Scope
- `e2e/**` only (specs, helpers, fixtures, `wdio.conf.ts`). **No product code** unless a spec proves a product defect — then stop and write `## Blocked` with the evidence.

## Requirements
1. Add `e2e/helpers/keys.ts` → `ensureProviderKeys(providers = ['openai','anthropic','google'])`: via Settings → API Keys, store dummy keys (`sk-TEST-e2e-…`) for each provider; call it at the start of every spec that needs LLM, embeddings or pipeline roles (including the scripted-LLM sessions).
2. Fix the selectors, announcement check, budget assertion and portfolio isolation exactly as in the table; read the component code to use real labels / roles — never guess.
3. Process hygiene for scripted drivers as described for TC-M1-006.
4. Keep test IDs and intent unchanged. Type-check `e2e` (`npx tsc --noEmit -p e2e`). **Do not run the E2E suite** — QA reruns it in one short session.

## Hand-back
Append `## Result` per AGENTS.md §3 with a table: case → change made.
