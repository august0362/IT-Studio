# OWNER-FB2-A — Sidecar: Auto uses every keyed provider, clear failure reasons, project delete/history

Milestone: v1 owner acceptance feedback (2026-10-16) · Role: Implementer (ROLES §1.3) · Size M · **Deps pre-installed; contracts already committed** (`project.delete`, `Project.lastOpenedAt` in `src/types/schemas.ts` + `validation/ipc.ts`, `validation/projects.ts`) · **Broad scope inside `apps/sidecar/**`: do not stop for edits needed to meet a requirement — list them in Result**

## Owner report

With only a Google and a DeepSeek key, Chat → Auto answered nothing to the first "xin chào" and then failed: *"Every model in the ladder was unavailable. Circuit open: Google (gemini-3.8-flash); No API key: Groq, OpenAI, Anthropic, xAI … Or add a model … to this role in Settings → Pipeline."* The sidecar log has **no line explaining why Google failed**, DeepSeek was never tried (not in the ladder), and the advice points chat users to *Pipeline*.

## Scope

- `apps/sidecar/src/**` (+ tests), a new Drizzle migration for `projects.last_opened_at` (generate it the repo's usual way), `apps/sidecar/test/integration/{router,settings-projects,chat}.test.ts` (new cases only).
- This task file (`## Result`). Desktop is OWNER-FB2-B.

## Requirements

1. **Auto includes keyed providers.** For chat *Auto (router ladder)*: after the configured ladder entries, append every **enabled** model with the `chat` capability whose provider has a stored key and that is not already in the ladder, in seed order. Do not change explicit model picks or pipeline role ladders.
2. **No dead end on open circuits.** If every candidate was skipped or failed and at least one keyed model was skipped only because its circuit is open, make **one** half-open probe on the most preferred such model before returning `LADDER_EXHAUSTED`.
3. **Log every failed or skipped attempt** at `warn`: `{ svc: 'router', requestId, modelKey, outcome, failure, httpStatus?, providerCode?, message? }`. `message` is the provider's error text passed through the existing redaction, max 200 chars. Never log prompt text or keys.
4. **Useful error text.** For each model, `LADDER_EXHAUSTED` remediation states the **last real failure** (e.g. "Google (gemini-3.8-flash): timed out after 30 s", "DeepSeek (deepseek-v4-flash): key rejected (401)") instead of only "Circuit open". Chat requests point to **Settings → Router**; pipeline requests keep **Settings → Pipeline**.
5. **`project.delete`.** Deletes the project and all IT Studio data scoped to it: conversations/messages, pipeline runs, knowledge documents/chunks, the project's LanceDB table, workflow activity, images and gallery rows (stored files under app data), ledger and revenue rows, project settings. **Never touches files under `workspaceRoot`.**
   - A running pipeline for that project → `CONFLICT`. Unknown id → `NOT_FOUND`.
   - Deleting the active project clears the active selection.
   - Publish an existing event, or reuse the list refresh, so the UI updates.
6. **History order.** `project.setActive` sets `lastOpenedAt = now`. `project.list` returns projects sorted by `lastOpenedAt` desc, then `createdAt` desc.
7. **Missing workspace at startup.** If a project's `workspaceRoot` no longer exists, journal recovery logs one `warn` (`svc: 'journal-recovery'`, `msg: 'Workspace folder missing'`) and skips it — not an `error` on every start.

## Tests (lean)

- Unit: ladder augmentation (keyed vs unkeyed vs disabled vs already present); half-open probe once; attempt-failure log shape and redaction; remediation text for chat vs pipeline with the last failure reason; `project.delete` removes every scoped row/table/file and leaves the workspace untouched; `CONFLICT` while a run is active; history ordering; missing-workspace warn.
- Integration: one case each in `router.test.ts` (keyed provider outside the ladder answers under Auto), `settings-projects.test.ts` (delete + list order), `chat.test.ts` (failure message names the reason).

## Acceptance criteria

- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass. QA runs the three integration files.

## Hand-back

Append `## Result` per AGENTS.md §3.
