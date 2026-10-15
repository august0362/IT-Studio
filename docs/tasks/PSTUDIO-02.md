# PSTUDIO-02 — Pipeline Studio: standalone, animated run view (add-on)

Milestone: v1 add-on (owner request 2026-10-15) · Role: Implementer (ROLES §1.3) · Size M · **Deps pre-installed** (`@xyflow/react`, React, Tailwind, CSS only — no new packages) · Depends on PSTUDIO-01 (landed)

## Goal

CONTEXT D35: an optional, **self-contained** page that shows a project's pipeline run as an n8n-style node canvas on its own **full-screen, pure-black, glowing** page. Input = the user's request; then the stages of the run. Live data visibly flows from module to module; a module shows **?** when it needs the user, **✓** when done; clicking a module shows all of its information. Removable by deleting its folder plus the touchpoints below; hideable with one flag.

## Read first

`AGENTS.md`, `CONVENTIONS.md`, `CONTEXT.md` D35, `src/types/schemas.ts` (`PipelineRun`, `PipelineEvent`, `ClarificationQuestion`, `pipeline.*` RPC/notifications), `apps/desktop/src/features/code/{CodePage,pipeline-store,ClarificationForm,StageTimeline,DiffViewer,SpecView,ReviewView,CommandOutput,FailureReportPanel}.tsx`, `apps/desktop/src/shell/{AppShell,MainNav}.tsx`, `apps/desktop/src/features/workflow/{WorkflowGraph,ActivityEdge}.tsx` (reference for `@xyflow/react` only).

## Scope — files you may create/modify

- `apps/desktop/src/features/pipeline-studio/**` (new; all code, data, CSS, tests, `README.md`)
- `apps/desktop/src/shell/MainNav.tsx` — only: add `'pipeline-studio'` to `ShellRoute` and one small button at the bottom of the Settings section
- `apps/desktop/src/shell/AppShell.tsx` — only: accept `#pipeline-studio` and render the studio page **instead of** the shell layout (no nav, tabs or status bar), passing the active project id and a back callback
- `apps/desktop/src/i18n/{en,vi}.json` — only `pipelineStudio.*` keys and the nav button label
- This task file (`## Result`)

## Requirements

1. **Isolation.** `features/pipeline-studio/index.ts` exports `PipelineStudioPage`, `PipelineStudioNavButton`, `PIPELINE_STUDIO_ENABLED` (`const`, default `true`). Shell files import only from that index; the page is lazy-loaded. The studio may import from core (`features/code/*`, `rpc`, `hooks`, `@itstudio/schemas`); **no core file other than the two shell touchpoints imports the studio**. `README.md`: how to hide (flag) and remove (delete folder + revert the touchpoints).
2. **Hide.** Flag `false` → no settings button; `#pipeline-studio` falls back to the default route.
3. **Entry/exit.** Settings button "Pipeline Studio" → `#pipeline-studio`. Page has "← Back" and `Esc` (when no panel open) to return to the previous route.
4. **Look.** `fixed inset-0`, background `#000`, ignores the app theme. Neon glow per state (idle = dim grey outline, active = cyan pulse, waiting = amber, done = green, failed/rolled back = red, skipped = faded dashed); subtle slow-moving background glow/dot grid. Top bar: project name, run picker (`pipeline.list` latest 20, newest selected; follows a newly started run), run status + cost, controls (Fit view, Reset layout, Replay).
5. **Canvas = modules only.** Nodes: **Request** (input) → **Clarify** → **Spec** → **Code** → **Review** → **Fix** → **Re-review** → **Write** → **Validate** → **Done**. Review → Write edge when approved first time; Fix/Re-review shown as a branch and marked *skipped* when not entered. Node card: icon glyph, name, short live caption (e.g. "3 questions", "4 files", "2 findings", "3/3 commands"), status badge. No other panels on the canvas.
6. **Status mapping** (pure, tested function from `PipelineRun` + `enteredStages` + `finished`): done ✓ for stages passed; active for the current stage; **?** on Clarify while `stage === 'clarifying'`; a queued run shows Request as amber "waiting" (no ?); failed ✕ on the failing stage (from `failureReport.stage`); Clarify is *skipped* when the run has no `clarifications`; Done ✓ only on `completed`.
7. **Live data flow.** Subscribe to `pipeline.event` / `pipeline.failureReport` (refetch with `pipeline.get`, like CodePage). On every transition a glowing packet travels along the edge from the previous node to the next (SVG `animateMotion` or CSS `offset-path`, 600–900 ms), the target then pulses; ✓ / ? / ✕ badges pop in smoothly. Active edges show a flowing dash. **Replay** re-animates the selected (finished) run from Request to its final stage. `prefers-reduced-motion`: no packets, badges appear instantly.
8. **Draggable.** Every node draggable; positions persist per viewer in `localStorage` (every access in try/catch; works without it). "Reset layout" restores the default left-to-right layout; initial view and Fit view show every node.
9. **Click → full info.** Clicking a node (not a drag) opens a glowing side panel (slides in; `role="dialog"`, close via ×, `Esc`, canvas click) with everything for that module, reusing core components where they exist: Request = prompt, start time, role assignment; Clarify = the `ClarificationForm` (answerable here while `clarifying`; read-only with Auto/User tags otherwise — the always-visible recommendations); Spec = `SpecView`; Code = coder summaries, assumptions, file operations / `DiffViewer`; Review/Re-review = verdicts and findings; Fix = attempt info; Write = transaction / changed files; Validate = command runs with `CommandOutput`; Done = result, total cost, duration, or the `FailureReportPanel`. Each panel also lists status, timings if known, and incoming/outgoing modules.
10. **Start from here.** A compact "New request" input under the top bar calls `pipeline.start` for the active project (disabled with a hint when no project is active); the new run is selected and animates live.
11. **Empty/error states.** No project → message + Back; no runs → empty canvas with Request node and the input; RPC errors shown in a glowing alert.
12. **Motion/a11y.** Transitions 150–400 ms eased; hover lift; no layout jank; real labelled buttons (en + vi), visible focus rings. No `dangerouslySetInnerHTML`, default exports, `any`.

## Tests (vitest + RTL, in the folder)

- status mapping: spec-direct run, clarifying-waiting (? on Clarify), auto-answered, fix branch entered vs skipped, failure at code (✕), rolled back, cancelled, completed (Done ✓), queued.
- animation queue (pure/hook, fake timers): transition A→B enqueues one packet on edge A→B; replay order; reduced motion → no packets.
- page: black full-screen root, all module names; `pipeline.event` triggers refetch and badge change; click Clarify while waiting → form → submit calls `pipeline.answerClarifications`; click Validate shows command output; Esc closes panel then Back; New request calls `pipeline.start`; layout persistence + Reset (normal and throwing `localStorage`).
- shell: Settings button → `#pipeline-studio` renders without `MainNav`; flag `false` (mock the index) → no button, hash falls back.

## Acceptance criteria

- [ ] Requirements met and covered by the tests above; existing shell tests stay green.
- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Hand-back

Append `## Result` per AGENTS.md §3.
