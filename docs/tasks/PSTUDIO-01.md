# PSTUDIO-01 — Pipeline clarifying step (questions, recommendations, Auto)

Milestone: v1 add-on (owner request 2026-10-15) · Role: Implementer (ROLES §1.3) · Size M · **Deps pre-installed**

## Goal

CONTEXT D35: before writing the spec, the PM may ask the user up to 5 clarification questions, each with options and one recommended option. The run waits in a new stage `clarifying` until answered — or, with `pipeline.autoClarify` on, the recommended options are chosen automatically and the run continues. Questions and answers are always visible in the run (a "Recommendations" section the user can read). PSTUDIO-02 (Pipeline Studio UI) builds on this; this task does the core only.

## Read first

`AGENTS.md`, `CONTEXT.md` D5, D11, D35, `src/types/schemas.ts` §pipeline (`PipelineStage`, `PipelineRun`, `PipelineEvent`, `PipelineSettings`, RPC map `pipeline.*`), `apps/sidecar/src/{domain/pipeline-machine.ts,services/pipeline-orchestrator.ts,prompts/pm.ts,domain/default-settings.ts}`, the sidecar settings load/validation path, `apps/desktop/src/features/code/**`, `apps/desktop/src/features/settings/pipeline/PipelineSettingsPage.tsx`.

## Scope — files you may create/modify

- `src/types/schemas.ts` — **additive only**, exactly the additions below
- `apps/sidecar/src/domain/pipeline-machine.ts`, `apps/sidecar/src/services/pipeline-orchestrator.ts`, `apps/sidecar/src/prompts/pm.ts`, `apps/sidecar/src/domain/default-settings.ts`, the sidecar settings validation/normalisation file(s) and the `pipeline.*` RPC handler file(s) (+ tests). No SQL migration.
- `apps/desktop/src/features/code/**` (+ tests)
- `apps/desktop/src/features/settings/pipeline/**` (+ tests)
- `apps/desktop/src/i18n/{en,vi}.json` (new keys only)
- This task file (`## Result`)

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
