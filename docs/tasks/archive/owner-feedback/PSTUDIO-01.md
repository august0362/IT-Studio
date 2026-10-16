# PSTUDIO-01 — Pipeline clarifying step (questions, recommendations, Auto)

Milestone: v1 add-on (owner request 2026-10-15) · Role: Implementer (ROLES §1.3) · Size M · **Deps pre-installed**

## Goal

CONTEXT D35: before writing the spec, the PM may ask the user up to 5 clarification questions, each with options and one recommended option. The run waits in a new stage `clarifying` until answered — or, with `pipeline.autoClarify` on, the recommended options are chosen automatically and the run continues. Questions and answers are always visible in the run (a "Recommendations" section the user can read). PSTUDIO-02 (Pipeline Studio UI) builds on this; this task does the core only.

## Read first

`AGENTS.md`, `../../../CONTEXT.md` D5, D11, D35, `src/types/schemas.ts` §pipeline (`PipelineStage`, `PipelineRun`, `PipelineEvent`, `PipelineSettings`, RPC map `pipeline.*`), `apps/sidecar/src/{domain/pipeline-machine.ts,services/pipeline-orchestrator.ts,prompts/pm.ts,domain/default-settings.ts}`, the sidecar settings load/validation path, `apps/desktop/src/features/code/**`, `apps/desktop/src/features/settings/pipeline/PipelineSettingsPage.tsx`.

## Scope — files you may create/modify

- `src/types/schemas.ts` — **additive only**, exactly the additions below
- `apps/sidecar/src/domain/pipeline-machine.ts`, `apps/sidecar/src/services/pipeline-orchestrator.ts`, `apps/sidecar/src/prompts/pm.ts`, `apps/sidecar/src/domain/default-settings.ts`, the sidecar settings validation/normalisation file(s) and the `pipeline.*` RPC handler file(s) (+ tests). No SQL migration.
- `apps/desktop/src/features/code/**` (+ tests)
- `apps/desktop/src/features/settings/pipeline/**` (+ tests)
- `apps/desktop/src/i18n/{en,vi}.json` (new keys only)
- This task file (`## Result`)
- **Scope amendment (Architect, 2026-10-15, answers `## Blocked`):** also allowed — `apps/sidecar/src/services/{role-caller,activity-recorder,settings-service}.ts`, `apps/sidecar/src/validation/{pipeline,settings,ipc}.ts`, `apps/sidecar/src/container.ts` (+ their tests), and settings fixtures in existing tests that only need the new `autoClarify` field (e.g. `apps/desktop/src/features/round1-coverage.test.tsx`, `apps/sidecar/src/services/web-chat-service.test.ts`). Fix the review findings recorded under `## Blocked` (exact optional props, RoleCaller typing, orchestrator narrowing, hydrating `clarifying` runs and queue gates after restart, clarification tests).

## Schema additions (`src/types/schemas.ts`)

```ts
// PipelineStage: add member
CLARIFYING: 'clarifying',

export interface ClarificationOption { readonly id: string; readonly label: string; readonly detail?: string }
export interface ClarificationAnswer {
  readonly optionId?: string;          // one of options[].id
  readonly freeText?: string;          // user's own answer (≤ 2 000 chars); at least one of optionId/freeText
  readonly by: 'user' | 'auto';
  readonly at: IsoDateTime;
}
export interface ClarificationQuestion {
  readonly id: string;
  readonly question: string;
  readonly why: string;                 // why the PM needs it
  readonly options: readonly ClarificationOption[];   // 2–4
  readonly recommendedOptionId: string;
  readonly recommendationReason: string;
  readonly answer?: ClarificationAnswer;
}
// PipelineRun: add optional field
readonly clarifications?: readonly ClarificationQuestion[];
// PipelineEvent: add member
| { readonly type: 'clarification'; readonly runId: PipelineRunId; readonly status: 'required' | 'answered' }
// PipelineSettings: add field
readonly autoClarify: boolean;
// RPC map: add
'pipeline.answerClarifications': {
  params: { readonly runId: PipelineRunId; readonly answers: readonly { readonly questionId: string; readonly optionId?: string; readonly freeText?: string }[] };
  result: PipelineRun;
};
```

## Requirements

1. **PM output.** The first PM call returns either `{ kind: 'spec', spec }` or `{ kind: 'questions', questions }` (one call, no extra round-trip). Update the PM prompt: ask only when the answer materially changes the spec; 0–5 questions; 2–4 options each; always a recommended option with reason. Validate the output (count limits, unique ids, `recommendedOptionId` ∈ options); invalid → existing invalid-output handling. After answers, the second PM call receives the Q&A in a `<context name="clarifications">` block and must return a spec (questions not allowed then — at most one clarification round per run).
2. **Machine.** `SPECIFYING --needs_clarification--> CLARIFYING --answered--> SPECIFYING`; `CLARIFYING --cancel--> CANCELLED`. Emit `stage` events as today plus `clarification` events (`required` / `answered`).
3. **Auto.** With `autoClarify = true`, each question gets `answer = { optionId: recommendedOptionId, by: 'auto' }`; the run passes through `clarifying` (emit both events) and continues without waiting.
4. **Manual.** Otherwise the run persists in `clarifying` and the orchestrator returns. `pipeline.answerClarifications` validates (run exists and is `clarifying`; every question answered; optionId valid or freeText non-empty ≤ 2 000 chars) → `VALIDATION`-style `AppError` otherwise; stores answers (`by: 'user'`) and resumes the run. A `clarifying` run survives a sidecar restart (it is waiting, not interrupted) and can be answered or cancelled afterwards. It keeps the project's run queue blocked like any unfinished run.
5. **Persistence.** `clarifications` lives in the run's existing artifacts JSON; old rows without it load fine.
6. **Settings.** `autoClarify` default `false`; stored settings without the field normalise to `false`. Pipeline settings page gets a labelled toggle "Auto-answer clarifying questions with the recommendation".
7. **Code page.** `clarifying` appears in the stage timeline (after the prompt, before Spec) with a "?" marker while waiting. A reusable, exported `ClarificationForm` component (in `features/code/ClarificationForm.tsx`) shows, per question: question, why, options as radio buttons with the recommended one preselected and tagged "Recommended" + reason, and a free-text alternative; buttons "Accept all recommendations" and "Submit answers". After answering (or in auto mode) it renders read-only with "Auto-chosen" / "Your answer" tags. Code page shows it for the selected run whenever `clarifications` exist. `pipeline-store` handles the new stage/event (refetch via `pipeline.get` as for other events).

## Tests

- machine transitions incl. cancel from `clarifying`;
- orchestrator: spec-directly path unchanged; questions + manual → waits in `clarifying`, answer → resumes to coding; auto → never waits, answers `by: 'auto'`; second PM call returning questions → invalid output; restart while `clarifying` keeps the run answerable;
- RPC validation errors (wrong stage, missing answer, bad optionId, empty/too long freeText);
- settings normalisation default `false`;
- `ClarificationForm`: preselected recommendation, accept-all, free text, read-only tags; Code page renders it and the "?" stage; settings toggle saves.

## Acceptance criteria

- [ ] Requirements 1–7 met and tested; existing pipeline tests unchanged and green.
- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Hand-back

Append `## Result` per AGENTS.md §3.

## Result

- Summary: Implemented the single PM clarification round, validated spec/questions envelopes, manual and automatic answers, clarification events, persisted Q&A, restart-safe waiting and project queue blocking, cancellation, settings normalisation/toggle, and the exported recommendations form with timeline support. Resolved every finding from the previous Blocked review: exact optional properties, RoleCaller schema/output typing, PM output narrowing, gate callback typing, run-cache hydration, restored queue gates, and missing regression tests. Scope expansion was explicitly approved by the Architect through the user's task instruction.
- Files changed:
  - Contracts: `src/types/schemas.ts` (only the task's additive contract changes).
  - Sidecar: `container.ts`; `domain/{default-settings,pipeline-machine}.ts`; `prompts/pm.ts`; `services/{pipeline-orchestrator,role-caller,activity-recorder,settings-service}.ts`; `validation/{pipeline,settings,ipc}.ts`, under `apps/sidecar/src/`.
  - Sidecar tests: `domain/pipeline-machine.test.ts`, `services/{pipeline-orchestrator,role-caller,activity-recorder,settings-service,web-chat-service}.test.ts`, and `validation/pipeline.test.ts` under `apps/sidecar/src/`. The web-chat fixture only adds `autoClarify`.
  - Desktop: `features/code/{ClarificationForm,CodePage,StageTimeline}.tsx`, `features/code/pipeline-store.ts`, their new/updated tests, `features/settings/pipeline/PipelineSettingsPage.tsx` and its new test, `features/round1-coverage.test.tsx` (only the new settings field), and new keys in `i18n/{en,vi}.json`, under `apps/desktop/src/`.
  - This task file replaces the answered Blocked section with Result.
- Dependencies added (with reason): None. `node_modules` was already present; no installation or manifest/lockfile changes were needed.
- Decisions taken within scope: No questions means the PM returns a spec; a questions envelope contains 1-5 questions. Invalid PM output uses the existing single validation retry. Accept all recommendations submits the recommended answers immediately. Manual answers reject duplicate/unknown question ids and invalid option ids, preserve the original 2,000-character limit, and use user attribution; auto answers use auto attribution. Waiting rows hydrate the run cache and restore the project's gate before a new run starts; the gate stays closed through resumed execution. Duplicate submissions are rejected. Existing artifacts JSON stores clarifications without a migration, and legacy settings retain their other saved values when autoClarify is added as false.
- Open issues / follow-ups: The required `npm.cmd --cache .npm-cache test` was attempted, but its existing pretest secret-scanner regression suite fails four tests because sandboxed Git prints `warning: unable to access 'C:\Users\admin/.config/git/ignore': Permission denied` to stderr, where those tests expect empty stderr. QA must rerun the exact command outside the sandbox. No tooling, global Git configuration, or protected files were changed to bypass this limitation. No commits were made.
- CHANGELOG draft for the Architect: Add an optional PM clarification round with recommended/manual/automatic answers, persisted recommendations, and restart-safe pipeline queues ([PSTUDIO-01](PSTUDIO-01.md)).
- Validation: `npm.cmd --cache .npm-cache exec -- prettier --write <changed files>` completed (the repository intentionally excludes Markdown and the shared schema from Prettier). Final `npm.cmd --cache .npm-cache run typecheck` and `npm.cmd --cache .npm-cache run lint` both passed. Ran the main test command separately after the pretest failure: `npm.cmd --cache .npm-cache exec -- vitest run --project sidecar --project desktop --project vscode-ext` passed 1,094 tests in 144 files, with one existing skipped test/file; `node --test scripts/release/*.test.mjs scripts/build/*.test.mjs` passed all 15 tests. An unchanged pricing-page test failed once while checks were running concurrently; its isolated rerun and final full-suite rerun passed. `git diff --check` passed, and all 32 changed/new paths were verified against the original and approved additional Scope. No real network or keychain was used in the added tests.
