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

## Result

| Case | Change made |
|---|---|
| TC-M4-025, TC-M4-033, TC-M4-042, TC-M4-051, TC-M5-020/022/023, TC-M6-070/071/072 | Added `ensureProviderKeys` in `e2e/helpers/keys.ts` and called it before specs that use chat, embeddings, or pipeline roles. |
| TC-M4-022/023, TC-M4-040/042 | Used accessible checkbox names for Auto Fallback and Hard Stop; scripted sessions save keys for OpenAI, Anthropic, Google, and Groq. |
| TC-M4-041 | Read the DnD live region announcement, including its trailing period, and checked the reordered ladder after reload. |
| TC-M4-031 | Asserted the active project's rendered budget usage label and compact spent `Money` format (`$0.00 · 0 ₫`) from `BudgetBars`. |
| TC-M4-032 | Added run-unique project names and checked only those projects' order and revenue rows. |
| TC-M1-006, TC-M4-021 | Added scripted-session teardown in `afterEach`, cleanup of suite-started desktop process trees in `onComplete`, and shutdown checks limited to the desktop/sidecar PIDs captured for the tested session. |

- Summary: Fixed E2E key setup, selectors, assertions, portfolio isolation, and scripted driver process cleanup without changing test IDs or intent.
- Files changed: `docs/tasks/QA-E2E-FIX1.md`, `e2e/helpers/keys.ts`, `e2e/helpers/ui.ts`, `e2e/specs/m4/chat.spec.ts`, `e2e/specs/m4/cost.spec.ts`, `e2e/specs/m4/scripted-llm.spec.ts`, `e2e/specs/m4/settings.spec.ts`, `e2e/specs/m4/shell.spec.ts`, `e2e/specs/m5/knowledge.spec.ts`, `e2e/specs/m6/code.spec.ts`, `e2e/wdio.conf.ts`.
- Dependencies added (with reason): None.
- Decisions taken within scope: Budget bars display `BudgetStatus.spent` using compact `Money`; the regression assertion matches that rendered spent value and usage label for a newly budgeted active project.
- Open issues / follow-ups: E2E suite not run as requested; QA should rerun it in the short session. `npm install` reported 34 existing dependency audit findings.

## QA (Claude) — round 2 (offline analysis of the 2026-10-03 re-run, 2 runs)
Now passing: TC-M4-032/033/040/042, TC-M1-006. VS Code L4: TC-M7-050/051 pass (runner must unset `ELECTRON_RUN_AS_NODE`), manual TC-M7-052 pass. QA fixed the `onPrepare` crash (`Get-Process` exits 1 when no process → added `; exit 0`).
Remaining failures — page text captured from the WDIO log right before each failure:

| Case | What the app showed | Cause | Fix |
|---|---|---|---|
| TC-M4-025 | composer text `first lineSHIFTENTERsecond lineENTER` | `browser.keys(['SHIFT','ENTER'])` types words | use `Key.Shift` / `Key.Enter` from `webdriverio` (and release Shift) |
| TC-M4-031 | `budget used: 0% · $0.00 · 0 ₫` | wrong expected text | assert the rendered text / `aria-label` exactly as `BudgetBars.tsx` renders it |
| TC-M4-041 | live region `Moved Gemini 3.8 Flash before Gemini 3.8 Flash.` repeatedly | keys sent in one burst; dnd-kit keyboard sensor needs time to measure | send `Key.Space`, pause ≥ 300 ms, `Key.ArrowDown`, pause ≥ 300 ms, `Key.Space` |
| TC-M5-020 (+022/023) | `guide.md · Indexed`, search returns no hits | fake embeddings score low; panel uses the settings default minScore | set the panel's "Minimum score" to 0 before searching |
| TC-M6-070/071/072 | pipeline failed in Specify: "The role returned an invalid response after one retry" | E2E scripted reply is plain text; PM / Coder / Reviewer need JSON | run the Code spec in a scripted session whose `ITSTUDIO_E2E_LLM_TEXT` is a JSON map model-id → role JSON (same shapes as `apps/sidecar/test/integration/pipeline.test.ts`); for TC-M6-071 a failing validation command; ensure the role models' providers have keys |
| TC-M4-021 | after Send, `Stop` never displayed | the slow-stream script is not on the model the router actually uses | select the scripted model explicitly in the picker (works with fallback after M4-FIX2) or script the first eligible ladder model |
| TC-M4-022/023 | `LADDER_EXHAUSTED` after 3 × model A | product BUG-M4-002 (being fixed in M4-FIX2) | keep the cases; make sure model B's provider has a key |
| TC-M4-043/044/045, TC-M4-051 | cascade / same spec session | re-check after the fixes above; fix selectors from component code if still failing | |

Do only these test fixes (e2e/** only), type-check and lint `e2e`. Do not run E2E. Also make `test:vscode-e2e` unset `ELECTRON_RUN_AS_NODE` for the VS Code child (in `apps/vscode-ext/test/e2e/run.mjs`, pass an env without it via `extensionTestsEnv`/launch env) and add `.vscode-test/` to `.gitignore`.

## Result (round 2)

| Case | Change made |
|---|---|
| TC-M4-025 | Sent Shift+Enter using WebdriverIO `Key` constants and released Shift. |
| TC-M4-031 | Asserted the rendered `budget used: 0%` label alongside the exact `0% budget used` accessible label and spent money. |
| TC-M4-041 | Sent keyboard sensor keys separately with 300 ms pauses. |
| TC-M5-020 | Set the knowledge panel's Minimum score to 0 before searching. |
| TC-M6-070/071/072 | Ran the Code specs through a scripted driver with model-id keyed PM/Coder/Reviewer JSON; TC-M6-071 uses a project-local compiler shim that fails validation. Saved provider keys and delete each scripted session after its case. |
| VS Code E2E | Removed `ELECTRON_RUN_AS_NODE` from the extension test child environment and ignored `.vscode-test/`. |

- Summary: Fixed the round 2 E2E regressions and VS Code test child environment.
- Files changed: `.gitignore`, `apps/vscode-ext/test/e2e/run.mjs`, `e2e/specs/m4/chat.spec.ts`, `e2e/specs/m4/cost.spec.ts`, `e2e/specs/m4/settings.spec.ts`, `e2e/specs/m5/knowledge.spec.ts`, `e2e/specs/m6/code.spec.ts`, `e2e/wdio.conf.ts`, `docs/tasks/QA-E2E-FIX1.md`.
- Dependencies added (with reason): None.
- Decisions taken within scope: M6 cases use a separate scripted driver so their structured role replies do not alter chat fixture behavior; the validation failure is deterministic and project-local.
- Open issues / follow-ups: E2E was not run as requested. E2E TypeScript check and lint passed.

## QA (Claude) — round 3 (final session 2026-10-03, 1 run)
23 pass incl. TC-M4-022/025/032/040/041/042/051, TC-M5-020; VS Code E2E pass. Remaining:

| Case | What the app showed | Cause | Fix |
|---|---|---|---|
| TC-M6-070/071/072 | "Failed during Write changes … INTERNAL … rolled back" | **product BUG-M6-002** (worker cannot create files in new dirs) — fixed in M6-FIX2 | none in the spec; re-run after M6-FIX2 |
| TC-M4-031, TC-M4-033 (cost spec) | a fallback decision modal ("Use / Retry same / Cancel") | **state leak:** settings spec (TC-M4-040) leaves Auto Fallback OFF in the shared per-run data dir; later specs see the modal when the first ladder model has no key | every spec that changes settings restores them in `after`/`afterEach` (Auto Fallback ON, ladder order, Hard Stop OFF, FX override cleared, price override cleared); additionally make `ensureProviderKeys` set keys for **all** providers so ladder order never hits a key-less model |
| TC-M4-023 | `use fallback` answered normally by Gemini | scripted session has its own data dir → Auto Fallback is ON there | turn Auto Fallback OFF inside the scripted session before sending (and restore) |
| TC-M4-021 | `Stop` never visible | the slow-stream script is keyed to a model the router does not use first | select the scripted slow model explicitly in the model picker (preferred model is tried first since M4-FIX2) |
| TC-M4-043/044/045, TC-M5-022/023 | no `Error in` line — failed in hooks / after a failure in the same spec | re-check once the leaks above are fixed; if still failing, fix from component code | |

e2e/** only; type-check and lint; do not run E2E.

## Result (round 3)

| Case / area | Change made |
|---|---|
| TC-M4-031/033 and router fallback across specs | `ensureProviderKeys` now saves keys for all four supported providers by default; cost-spec teardown restores Auto Fallback ON. |
| TC-M4-040/041/042/043/045 | Settings teardown restores Auto Fallback ON, the original ladder order, Hard Stop OFF, and clears any FX override. |
| TC-M4-043 | Settings teardown restores GPT-5.5 prices to the checked-in seed values (5 / 30 / 0.5 USD per MTok) after the override assertion. |
| TC-M4-021 | The slow scripted chat selects `openai/gpt-5.4-mini` explicitly before sending. |
| TC-M4-023 | Keeps Auto Fallback OFF for the scripted fallback modal case; scripted-session teardown restores it ON before deleting the session. |

- Summary: Addressed the round 3 scripted model selection, all-provider test keys, and settings state leakage.
- Files changed: `e2e/helpers/keys.ts`, `e2e/specs/m4/cost.spec.ts`, `e2e/specs/m4/scripted-llm.spec.ts`, `e2e/specs/m4/settings.spec.ts`, `docs/tasks/QA-E2E-FIX1.md`.
- Dependencies added: None.
- Verification: E2E TypeScript check and ESLint passed. E2E was not run as requested.
- Open issues / follow-ups: The pricing settings UI has no clear-override action, so cleanup restores GPT-5.5's seeded values; the row remains marked overridden. No out-of-scope product change was made.
