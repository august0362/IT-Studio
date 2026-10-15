# PROC-02 — Processes page + generic process pipeline viewer (desktop)

Milestone: PROC (CONTEXT D40) · **After PROC-01 and UX-03 land** · Role: Implementer · Size L · **Deps pre-installed** · **Broad scope inside `apps/desktop/src/**`: do not stop for edits needed to meet a requirement — list them in Result**

## Goal

A **Processes** page that lists every process with a coloured dot, and a full-screen black **pipeline viewer** (the Pipeline Studio look and feel) that draws any process from its `modules`/`edges`, shows data moving module to module to the final result, lets modules be dragged, and shows each module's input/output on click.

## Requirements

1. **Sidebar** entry **Processes** (after Workflow) with a small badge: count of running (green) + waiting (yellow) + stopped (red) processes.
2. **Processes page:** list from `process.list` (limit 100, current project + an "All projects" toggle), live via `process.event`. Each row: dot (🟢 running, 🟡 waiting, 🔴 stopped, ⚪ ended — colour + text label for a11y), kind icon/label, title, project, started/updated time, cost text, status reason. Filters: status chips, kind select, search. Row actions: **Open** (viewer), **Cancel** (running/waiting), **Retry** (stopped & retryable), **Dismiss** (stopped → ended), **Delete** (ended). Grouped headings: Running · Waiting · Stopped · Ended (newest 20).
3. **Process viewer** (full-screen black, reuse/extract from `features/pipeline-studio`): a generic `ProcessGraph` that renders `modules` + `edges` with the existing node styles, badges (✓ done, ✕ failed, ? waiting for user, ● active, — idle/skipped), glowing packet animation on every module transition (from `process.event`), drag + saved layout per **kind** (localStorage, try/catch), Fit view / Reset layout / Replay. Clicking a module opens the side panel with label, state, times, input, output and `detail` key/values; plus links via `ref` (open conversation, open Code run, open Knowledge job, open image, open pricing). For `code_pipeline` the panel keeps the rich Pipeline Studio panels (ClarificationForm etc.).
4. **Pipeline Studio** becomes this viewer: the Settings → Labs launcher opens the Processes page filtered to code pipelines; `PIPELINE_STUDIO_ENABLED` still hides the add-on entry points.
5. **Web chat** reporting: the Web chat page calls `process.report` on pane open / load / close / load failure (no page content).
6. **Status bar**: small dots with counts (green/yellow/red); click opens the Processes page.

## Tests (lean, RTL + fake RPC)

List grouping and dot/label per status; live upsert/removed events; each action calls the right RPC and is shown only in the right state; viewer renders a chat graph and a knowledge graph from data, animates a packet on module transition, opens the panel with input/output/detail, drag layout persisted per kind; web chat reports open/close; status-bar counts.

## Acceptance criteria

- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass. QA takes screenshots (mock harness) of the list and of a chat/knowledge/code viewer, and runs the affected E2E specs.

## Hand-back

Append `## Result` per AGENTS.md §3.
