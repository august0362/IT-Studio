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

## Result

- Summary: Chat Auto appends enabled, keyed chat models in seed order. Exhausted requests make at most one preferred half-open probe, including circuits opened during a retry. Failed/skipped attempts are logged at warn with redacted, bounded provider diagnostics; exhaustion messages retain the last actual failure and direct chat to Router settings. Added project deletion, last-opened history ordering, and missing-workspace recovery warnings. No commit was made.
- Files changed: `apps/sidecar/src/container.ts`, `container.test.ts`; `domain/{remediation.ts,remediation.test.ts}`; `infra/sqlite/{schema.ts,project-repository.ts,migrations/0012_project_history.sql,migrations/meta/0012_snapshot.json,migrations/meta/_journal.json}`; `ports/{llm-provider.ts,project-repository.ts}`; `providers/{anthropic/anthropic-provider.ts,google/google-provider.ts,openai-compatible/openai-compatible-provider.ts}`; `services/{activity-recorder.ts,activity-recorder.test.ts,circuit-breaker.ts,circuit-breaker.test.ts,journal-recovery.ts,journal-recovery.test.ts,llm-router.ts,llm-router.test.ts,pipeline-orchestrator.ts,project-service.ts,project-service.test.ts,settings-service.ts}`; `apps/sidecar/test/integration/{router,settings-projects,chat}.test.ts` (new cases and their import only); this task file. Paths abbreviated after `apps/sidecar/src/` share that prefix.
- Dependencies added (with reason): None. Missing `node_modules` was restored with `npm.cmd --cache .npm-cache install`; manifests and lockfile are unchanged.
- Decisions taken within scope: Appended models use a 30-second first-byte timeout and no same-model retries; explicit picks, locked picks, and pipeline role ladders retain their existing candidates. Probe admission still permits only one concurrent half-open call. Provider codes remain internal to the sidecar port. SQLite deletion uses existing cascades plus explicit transactional activity removal; vectors and canonical app-data image files are removed before deleting rows. Workspace paths are never used as deletion targets; an image/workspace overlap returns `CONFLICT`. Pipeline admission/queued work and nonterminal persisted runs block deletion. Cached pipeline runs and workflow activity are cleared, and late activity cannot recreate deleted history. The mutation acknowledgement supports the `project.list` refresh specified for OWNER-FB2-B. Project-specific budget settings cascade; app-global settings are retained, with a conditional, serialized clear of the active selection.
- Validation: Changed files formatted with `npm.cmd --cache .npm-cache exec -- prettier --write <changed files>`; `npm.cmd --cache .npm-cache run typecheck`, `npm.cmd --cache .npm-cache run lint`, and `npm.cmd --cache .npm-cache test` passed. Final suite: 1,421 Vitest tests passed, one existing skipped test; 26 Node script tests passed. Tests cover keyed/disabled/duplicate model augmentation, probe bounds, redaction, failure reasons/settings destinations, every scoped SQLite table, actual LanceDB table removal, stored image cleanup, workspace preservation, active-run conflicts, history ordering, late workflow activity, and missing-workspace warnings. `git diff --check` passed. Test/lint subprocesses used process-local `XDG_CONFIG_HOME=<worktree>/.npm-cache` to avoid Git's inaccessible global ignore-file warning; repository tooling was unchanged.
- Open issues / follow-ups: The three requested integration files were attempted, but all 37 cases stopped before `system.ready` because `tsx` hit the documented sandbox `os.userInfo()` / `uv_os_get_passwd` ENOMEM failure. QA must rerun them outside the sandbox. Static review also identifies existing TC-M2-006 and TC-M2-051 fixtures that expect exhaustion while leaving other enabled chat models/providers keyed; QA should isolate or script those additional Auto candidates. Existing integration cases were left unchanged per the new-cases-only scope. The usual `db:generate` command hit the same sandbox failure; migration SQL and snapshot were generated with the installed Drizzle Kit SQLite generator API, without dependency or tooling changes.
- Changelog draft for Architect: Fix Auto routing across keyed providers, preserve actionable provider failures, and add safe project deletion with ordered project history (OWNER-FB2-A).

## QA round 1 (Architect, 2026-10-16) — test-only

Targeted integration: 38 pass, 2 fail as you predicted — `router.test.ts` TC-M2-006 and `chat.test.ts` TC-M2-051 expect ladder exhaustion, but Requirement 1 now appends the other keyed, enabled chat models, so the run no longer exhausts and the tests time out. Intended behaviour. **Scope amendment:** edit only those two tests: make the extra Auto candidates fail too (script them to the same failure) or disable them via `settings.update`/model config before the request, so the run exhausts again; keep every existing assertion (all attempted models reported; sanitized details). Then append `## Result — QA round 1`.

## Result — QA round 1

- Summary: Updated only TC-M2-006 and TC-M2-051 to script all additional Auto candidates from the keyed Google and Groq providers with the same HTTP 503 failure. Every existing assertion is preserved. No commit was made.
- Files changed: `apps/sidecar/test/integration/router.test.ts`, `apps/sidecar/test/integration/chat.test.ts`, this task file (this result section only; the existing QA instructions were preserved).
- Dependencies added (with reason): None; `node_modules` was already present.
- Decisions taken within scope: Retained Auto augmentation in both tests and extended their failure fixtures rather than changing shared setup or production code.
- Validation: Changed files formatted with `npm.cmd --cache .npm-cache exec -- prettier --write <changed files>`. `npm.cmd --cache .npm-cache run typecheck`, `npm.cmd --cache .npm-cache run lint`, and `npm.cmd --cache .npm-cache test` passed (1,439 Vitest tests passed, one existing skipped test; 26 Node script tests passed). `git diff --check` passed. Lint/test subprocesses used process-local `XDG_CONFIG_HOME=<worktree>/.npm-cache` as in the original task run; repository tooling was unchanged.
- Open issues / follow-ups: Both targeted integration tests were attempted individually with `npm.cmd --cache .npm-cache run test:integration -- <file> -t <case ID>`. Both stopped before `system.ready` because `tsx` encountered the documented sandbox `os.userInfo()` / `uv_os_get_passwd` ENOMEM failure. QA must rerun TC-M2-006 and TC-M2-051 outside the sandbox; tooling was unchanged.
