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

## Blocked

- Requirement 5 cannot be completed within `apps/desktop/src/**`: `IWebChatHost.sync()` and `reload()` acknowledge native commands, while `apps/desktop/src-tauri/src/webchat.rs` creates/reloads child webviews without forwarding page-load completion or navigation failure events to React. A successful native command is not evidence that the remote page loaded.
- Question for Architect: provide a native lifecycle event bridge (pane/link identity plus loaded/failed, with no page content), or extend this task's Scope to include the necessary `apps/desktop/src-tauri/src/webchat.rs` changes. No contract/specification or native files were modified.
- Tried: inspected the native webview builder and desktop host APIs. Implemented reports for open/close and command failures; deliberately do not emit `loaded` based on pane-creation/reload acknowledgement. Stopped feature work per AGENTS.md §4; completing verification and documenting the partial implementation to leave the codebase compiling.

## Result

- Summary: Partial implementation, blocked on requirement 5 above. Added the live Processes list with project/status/kind/search filters, grouped status labels/dots, state-specific actions, sidebar badge and status-bar counts. Added the full-screen data-driven process graph, transition packets/replay, drag layouts saved per kind, module input/output/detail/times and reference navigation. Labs now launches Processes filtered to code pipelines; rich code panels remain behind `PIPELINE_STUDIO_ENABLED`. Web chat reports open/close and native command failures without page content.
- Files changed: `apps/desktop/src/features/processes/*` (viewer, graph, list, counts, layout/event hooks, shared extracted styles and RTL/fake-RPC tests); `features/pipeline-studio/{ProcessCodePanel.tsx,StudioPanel.tsx,index.ts,studio.css,PipelineStudioPage.test.tsx,studio-shell.test.tsx,test-support.tsx}`; `features/webchat/{WebChatPage.tsx,WebChatPage.test.tsx,use-native-webchat-panes.ts,useWebChatReporting.ts}`; `features/gallery/GalleryPage.tsx`; `components/StatusBar.tsx`; `shell/{AppShell.tsx,AppShell.test.tsx,MainNav.tsx}`; `state/navigation-intent.ts`; `i18n/{en,vi}.json`; this task file. All desktop paths are under `apps/desktop/src/`.
- Dependencies added (with reason): None. Restored the existing dependencies using `npm.cmd --cache .npm-cache install` because `node_modules` was missing; package manifests and lockfile are unchanged. Used `.cmd` executables because PowerShell blocks npm's `.ps1` shim.
- Decisions taken within scope: Reused extracted Pipeline Studio CSS; inject rich code panels from the shell so the generic process feature does not import the add-on. Query current-project/all-project lists with limit 100, merge notifications into the query cache, and retain the newest 20 ended rows. Validate saved layout JSON with the existing zod dependency and tolerate unavailable localStorage. Resolve reference links through existing navigation intents, including an additive image intent. Keep legacy `#pipeline-studio` as a filtered-list entry when the add-on is enabled.
- Verification: Ran targeted `npx.cmd --cache .npm-cache prettier --write` before checks. `npm.cmd --cache .npm-cache run typecheck` passed, `npm.cmd --cache .npm-cache run lint` passed, and `git diff --check` passed. Direct full Vitest run passed with exit code 0: 166 files passed / 1 skipped, 1,519 tests passed / 1 skipped. Covered grouping/status labels/actions, filtering, live upsert/removal, counts, chat/knowledge graphs and panels, rapid transition packets/replay, real node dragging/restoration/reset, denied/corrupt storage, and web-chat open/close/command failure reports.
- Open issues / follow-ups: Native page-load completion/navigation-failure reporting remains blocked as detailed above; do not mark requirement 5 complete. `npm.cmd --cache .npm-cache test` failed in the pretest secret-scanner regression tests because Git emits `warning: unable to access 'C:\Users\admin/.config/git/ignore': Permission denied` in this sandbox; those tests require empty stderr. Ran the full Vitest suite separately without altering tooling. QA must rerun the complete npm test command outside the sandbox, take the requested mock-harness screenshots and execute affected E2E specs. No PROC milestone test-case document was present in `docs/qa/`. No commits were created.
- Changelog draft for Architect: Add a live Processes page and generic pipeline viewer with per-kind layouts, module details, activity counts and reference navigation (PROC-02; native web-chat load reporting pending).

## Architect decision on Blocked (2026-10-16)

Accepted as delivered. Web-chat processes record `open` and `closed` (and `failed` when the pane cannot be created) from the desktop; the native page-loaded signal needs a Tauri/Rust change and is deferred to follow-up **PROC-04** (emit `webchat://loaded` from the child webview and report `loaded`). No further work in PROC-02.
