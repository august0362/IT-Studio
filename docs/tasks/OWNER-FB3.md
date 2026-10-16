# OWNER-FB3 — Process pipeline correctness, pipeline roles use keyed providers, delete updates counts, settings search suggestions

Milestone: v1 owner acceptance feedback (2026-10-16, round 3) · Role: Implementer · Size M · **Deps pre-installed** · **Broad scope inside `apps/sidecar/**` and `apps/desktop/src/**`: do not stop for edits needed to meet a requirement — list them in Result**

## Owner reports (screenshots)

1. In the code-pipeline process viewer, **Spec shows ✓ "spec completed" while Clarify still shows ? (waiting)** — a stage is ticked before it happened. Captions are wrong too: Clarify and Code both show "spec completed".
2. A code pipeline failed with `LADDER_EXHAUSTED … Missing required capability: Google (gemini-embedding-2); No API key: OpenAI (gpt-5.3-codex, gpt-5.5), Anthropic (claude-sonnet-5-5); Google (gemini-3.1-pro-preview): quota exhausted (429); Google (gemini-3.8-flash): provider unavailable (504)`. The owner also has a **DeepSeek** key that was never tried. An embedding model should never be listed as a chat candidate.
3. After deleting a stopped pipeline process, the **red counter still shows 1**.

## Diagnosis (Architect)

- `apps/sidecar/src/services/process-activity.ts`: `step()` sets the next module's `input` to `lastOutput` and `done()` defaults output to `"<module> completed"`. The viewer caption shows that text, so later modules show "spec completed". The orchestrator also marks `spec` done when the first PM call returns **questions** (the run goes to `clarifying`), so Spec is ticked before the spec exists.
- OWNER-FB2-A augmented only chat *Auto*; pipeline role ladders (pm/coder/reviewer) are not augmented with keyed providers. Candidate lists include models without the required capability.
- `process.delete` accepts only `ended`; the desktop count/badge does not refresh on `removed`/status changes from every action path.

## Requirements

1. **Correct module states for `code_pipeline`:**
   - When the PM returns questions: `spec` stays `idle`, `clarify` becomes `waiting` (manual) or `done` (auto), process status `waiting` (manual).
   - `spec` becomes `active` only on the PM call that produces the spec, and `done` only when a valid spec exists.
   - Apply the same rule to every module: `done` only after its real output exists; `skipped` for fix/re-review when not entered; `failed` on the failing module only. Later modules stay `idle`.
2. **Meaningful captions/summaries:**
   - Each module's `output` describes its own result: Clarify "3 questions · 2 answered (auto)", Spec = spec title, Code "4 files", Review "approved · 1 finding" / "changes requested · 2 major", Write "3 files written", Validate "3/3 commands passed", Done "completed · $0.04".
   - `input` is a short description of what came in (e.g. Spec input "request + 3 answers"), not the previous module's output text.
   - Never use the generic `"<module> completed"`.
   - Fix the equivalent captions for the other kinds if they use the same helper.
3. **Pipeline roles use keyed providers:**
   - For each pipeline role, after its configured ladder, append every enabled model whose provider has a stored key and that has the role's required capabilities. pm/reviewer: `chat` + `json_mode`; coder: `chat` + `json_mode` + `code`.
   - Pre-flight uses the augmented ladders.
4. **Capability filter:**
   - Models without the required capability (e.g. embedding models) are removed from candidate lists before attempts.
   - They never appear in `LADDER_EXHAUSTED` text, for chat or pipeline.
5. **Delete and counts:**
   - `process.delete` accepts `stopped` and `ended`. For `stopped` it first performs dismiss semantics, then removes the record.
   - The desktop shows **Delete** for stopped and ended rows, with a confirm.
   - After cancel / retry / dismiss / delete — and on every `process.event` (`upsert` or `removed`) — the Processes list, the sidebar badge and the status-bar counts update immediately, sharing one query cache key.
7. **Settings search suggestions (owner, same round):**
   - From the **first character** typed in the Settings search box, show a suggestion dropdown (combobox pattern, `role="listbox"`).
   - It lists matching **sections** and **individual settings inside them**, e.g. "p" → *Pipeline*, *Pricing*, *Pipeline → Auto-answer clarifying questions*, *Appearance → Primary theme*.
   - Matching: case- and diacritic-insensitive substring on the title, the setting label (en + vi) and keywords. Rank prefix matches first, then word-start matches, then the rest. Highlight the matched letters. Show at most 8 results, each with its section as a secondary line.
   - Keyboard ↑/↓/Enter/Esc and mouse click. Choosing a result opens that section and scrolls to + focuses the exact field (via a stable `id` per setting).
   - Build the index from a static list in `settings-sections.ts` (section id, setting id, en/vi labels, keywords) covering every visible setting.
   - Tests: "p" suggestions and ordering, a diacritic-insensitive Vietnamese query, keyboard selection focuses the field, Esc closes.
6. **Legacy Pipeline Studio code view** (rich panels) shows the same states as the process viewer. Reuse one mapping, no duplicate logic.

## Tests (lean)

- Unit: questions path keeps `spec` idle and `clarify` waiting/done; auto path; spec/code/review/write/validate captions; fix/re-review skipped; failure marks only the failing module.
- Pipeline ladder augmentation per role incl. the coder `code` capability; capability filter drops embedding models from attempts and messages.
- `process.delete` on stopped/ended and a `VALIDATION` error on running.
- Desktop: counts and badge drop after delete/dismiss, and on a `removed` event.
- Integration (targeted): `processes.test.ts` + `pipeline.test.ts` cases for the questions path and a keyed-provider coder.

## Acceptance criteria

- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass. QA runs `processes`, `pipeline`, `router` integration files.

## Hand-back

Append `## Result` per AGENTS.md §3.

## Result
- Summary: Correct code-pipeline module states and summaries from actual artifacts; share those process modules with the legacy Studio; augment role ladders with keyed, capable models; filter capability mismatches before attempts; allow confirmed deletion of stopped/ended processes and synchronize all process consumers; add bilingual Settings suggestions with keyboard navigation, highlighting and exact field focus.
- Files changed:
  - `apps/desktop/src/features/pipeline-studio/PipelineStudioNavButton.tsx`
  - `apps/desktop/src/features/pipeline-studio/PipelineStudioPage.test.tsx`
  - `apps/desktop/src/features/pipeline-studio/PipelineStudioPage.tsx`
  - `apps/desktop/src/features/pipeline-studio/StudioGraph.tsx`
  - `apps/desktop/src/features/pipeline-studio/studio-model.test.tsx`
  - `apps/desktop/src/features/pipeline-studio/studio-model.ts`
  - `apps/desktop/src/features/pipeline-studio/test-fixtures.ts`
  - `apps/desktop/src/features/pipeline-studio/test-support.tsx`
  - `apps/desktop/src/features/processes/ProcessesPage.test.tsx`
  - `apps/desktop/src/features/processes/ProcessesPage.tsx`
  - `apps/desktop/src/features/processes/test-support.tsx`
  - `apps/desktop/src/features/processes/useProcesses.ts`
  - `apps/desktop/src/features/settings/SettingsPage.test.tsx`
  - `apps/desktop/src/features/settings/SettingsPage.tsx`
  - `apps/desktop/src/features/settings/SettingsSearch.tsx`
  - `apps/desktop/src/features/settings/api-keys/ApiKeysPage.test.tsx`
  - `apps/desktop/src/features/settings/api-keys/QwenEndpoint.tsx`
  - `apps/desktop/src/features/settings/budget/BudgetSettingsPage.tsx`
  - `apps/desktop/src/features/settings/fx/FxSettingsPage.tsx`
  - `apps/desktop/src/features/settings/images/ImagesSettingsPage.tsx`
  - `apps/desktop/src/features/settings/pipeline/PipelineSettingsPage.tsx`
  - `apps/desktop/src/features/settings/pricing/PricingExtractionControl.tsx`
  - `apps/desktop/src/features/settings/pricing/PricingSettingsPage.tsx`
  - `apps/desktop/src/features/settings/router/RouterSettingsPage.tsx`
  - `apps/desktop/src/features/settings/settings-sections.ts`
  - `apps/desktop/src/features/settings/settings-target.ts`
  - `apps/desktop/src/features/settings/theme/ThemePage.tsx`
  - `apps/desktop/src/features/settings/vscode/VSCodeSettingsPage.tsx`
  - `apps/desktop/src/features/settings/web-chat/WebChatSettingsPage.tsx`
  - `apps/desktop/src/i18n/en.json`
  - `apps/desktop/src/i18n/vi.json`
  - `apps/sidecar/src/domain/pipeline-models.test.ts`
  - `apps/sidecar/src/domain/pipeline-models.ts`
  - `apps/sidecar/src/domain/pipeline-process.ts`
  - `apps/sidecar/src/services/llm-router.test.ts`
  - `apps/sidecar/src/services/llm-router.ts`
  - `apps/sidecar/src/services/pipeline-orchestrator.test.ts`
  - `apps/sidecar/src/services/pipeline-orchestrator.ts`
  - `apps/sidecar/src/services/process-activity.ts`
  - `apps/sidecar/src/services/process-registry.test.ts`
  - `apps/sidecar/src/services/process-registry.ts`
  - `apps/sidecar/src/services/role-caller.test.ts`
  - `apps/sidecar/src/services/role-caller.ts`
  - `apps/sidecar/test/integration/pipeline.test.ts`
  - `apps/sidecar/test/integration/processes.test.ts`
  - `docs/tasks/OWNER-FB3.md`
- Dependencies added (with reason): None. Restored the existing locked dependencies with `npm --cache .npm-cache install` because this worktree had no node_modules; package manifests and lockfiles are unchanged.
- Decisions taken within scope:
  - The first PM pass is represented by Clarify until its output is known. Spec stays idle on questions and becomes active for specification production; only real artifacts complete modules. Unentered fix/re-review modules are skipped. Unsafe coder paths fail Code before Review is entered.
  - The sidecar owns the module mapping; both desktop viewers consume its process modules. Studio waits for graph node registration before fitting its viewport.
  - All process consumers use one global query cache and derive project filters locally. Action responses and both event types update it directly; in-flight snapshots cannot overwrite received events.
  - Deleting a stopped record performs its dismissed transition before removal, preserving the other twenty ended records.
  - Settings uses a static bilingual index, stable targets (including repeated setting groups), prefix/word/substring ranking and up to eight suggestions. Searching can reveal conditional custom-path fields without saving a preference change.
- Validation: Required checks run; final results recorded below.
- Open issues / follow-ups: The targeted processes, pipeline and router integration files cannot start the child sidecar in this sandbox: tsx fails in os.userInfo() with uv_os_get_passwd / ENOMEM before system.ready. QA must rerun them outside the sandbox, as documented by AGENTS.md. No tooling changes were made to bypass this limit.
- Test environment: Shell-local Git configuration points core.excludesFile at an empty file under .npm-cache and preserves safe.directory for this worktree, avoiding inaccessible global Git configuration during secret-scanner checks. No global Git settings were changed.
- CHANGELOG draft for the Architect: Fix process pipeline states, capable keyed-provider fallback, synchronized process deletion/counts and Settings search suggestions (OWNER-FB3).

## Blocked

- Verification dependency: `npm.cmd --cache .npm-cache test` passes the application Vitest suites (1,533 passed, one existing skip), then `scripts/build/polish.test.mjs` fails before its tests run because `scripts/build/make-icon.mjs` cannot import `sharp` (`ERR_MODULE_NOT_FOUND`). `npm.cmd --cache .npm-cache ls sharp --all` returns an empty tree, and neither the root nor sidecar has an installed `sharp` package. The existing lockfile contains sharp, but it is absent from this worktree's installed dependencies.
- Precise question for the Architect: Can the pre-installed dependency set be repaired so the existing build-script tests can resolve the locked `sharp` package, then QA rerun `npm --cache .npm-cache test`? AGENTS.md §5 says deps-pre-installed tasks must report missing packages as blocked; no package installation, manifest/lockfile edit, or tooling workaround was attempted in this continuation.
- Separate sandbox verification limit: the requested `processes.test.ts`, `pipeline.test.ts`, and `router.test.ts` integration files all fail before `system.ready` because tsx calls `os.userInfo()` and receives `uv_os_get_passwd` / `ENOMEM`. QA must rerun them outside this sandbox per AGENTS.md §5.

## Result

- Summary: Reviewed the interrupted implementation against every OWNER-FB3 requirement. Completed the remaining Settings search targets for individual Web Chat fields and the Router model-enabled control, added Vietnamese theme-mode matching, handled deletion of an already absent process without retaining stale rows/counts, and updated the existing Google-only pipeline integration case to verify automatic role-ladder augmentation. The preceding Result describes the full implementation; validation remains blocked as detailed above.
- Files changed: All files enumerated in the preceding Result, plus `apps/desktop/src/features/settings/router/RouterSettingsPage.test.tsx` and `apps/desktop/src/features/settings/web-chat/WebChatSettingsPage.test.tsx`. All code/test edits are inside `apps/desktop/src/**` and `apps/sidecar/**`; only this task document was appended outside those paths.
- Dependencies added (with reason): None. `node_modules` was present at continuation startup. No dependencies were installed or package manifests/lockfiles changed during this continuation.
- Decisions taken within scope: Repeated Web Chat settings and Router enable toggles have one stable search target on the first visible row, so selection focuses the actual control. A successful idempotent delete response clears the local process regardless of its `deleted` flag. Pipeline augmentation applies to a run without rewriting the user's saved role ladders; the superseded Google-only rejection integration assertion now tests that behavior.
- Validation:
  - `npm.cmd --cache .npm-cache exec -- prettier --write <changed files>`: passed before checks; Markdown files follow the repository's existing formatter exclusion.
  - `npm.cmd --cache .npm-cache run typecheck`: passed on the final code, including integration test types.
  - Latest full `npm.cmd --cache .npm-cache test`: application suites passed (167 files passed, one existing skipped file; 1,533 tests passed, one existing skip). The subsequent Node build-script suite passed 24 tests and failed to load `polish.test.mjs` because sharp is missing. No complete npm-test pass is claimed.
  - After the final search-target changes, targeted Settings, Web Chat, Router and Processes UI suites passed: four files, 50 tests, exit code 0.
  - An initial concurrent full-suite run timed out in unchanged `CodePage.test.tsx` case `QA-BREAK-02-D04`; its isolated rerun passed all six tests, and the subsequent full application run passed that case.
  - Requested processes/pipeline/router integration files were attempted: all 36 cases were blocked before sidecar startup by the documented tsx/os.userInfo sandbox limitation.
  - `git diff --check`: passed. No commit, push, reset or tooling changes were made.
- Open issues / follow-ups: Architect must repair the missing pre-installed sharp dependency and rerun the full npm test command; QA must run the three integration files outside the sandbox. See the precise question in Blocked above.
- CHANGELOG draft for the Architect: Fix process pipeline states and summaries, capable keyed-provider fallback, synchronized process deletion/counts, and bilingual Settings search suggestions (OWNER-FB3).
- Final checks after correcting an unnecessary async test callback: `npm.cmd --cache .npm-cache run lint` passed (ESLint, repository Prettier check and secret scan, exit code 0); typecheck passed again; the final Settings suite passed all 29 tests. Full-test and integration blockers above remain unresolved.
