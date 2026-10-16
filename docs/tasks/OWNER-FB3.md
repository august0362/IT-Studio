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
