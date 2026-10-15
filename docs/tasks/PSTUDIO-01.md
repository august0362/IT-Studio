# PSTUDIO-01 — Pipeline Studio: standalone animated architecture view (add-on)

Milestone: v1 add-on (owner request 2026-10-15) · Role: Implementer (ROLES §1.3) · Size M · **Deps pre-installed** (use `@xyflow/react`, React, Tailwind, CSS only — no new packages)

## Goal

An optional, **self-contained** module that shows the IT Studio architecture (the diagram in `apps/desktop/src/features/pipeline-studio/assets/architecture.png`) as an interactive n8n-style node canvas on its own **full-screen, pure-black, glowing** page. It is an add-on: it must be removable by deleting its folder plus the few touchpoints listed below, and hideable with one flag.

## Read first

`AGENTS.md`, `CONVENTIONS.md`, `apps/desktop/src/shell/{AppShell,MainNav}.tsx`, `apps/desktop/src/features/workflow/{WorkflowGraph,ActivityEdge,ModuleNode}.tsx` (reference for `@xyflow/react` usage only — do not import from `workflow/`), the asset image.

## Scope — files you may create/modify

- `apps/desktop/src/features/pipeline-studio/**` (new; everything lives here, incl. tests and its own CSS file)
- `apps/desktop/src/shell/MainNav.tsx` — only: add `'pipeline-studio'` to `ShellRoute` and one small button in the Settings section
- `apps/desktop/src/shell/AppShell.tsx` — only: accept the route from the hash and render the studio page **instead of** the shell layout (no nav, no tabs, no status bar)
- `apps/desktop/src/i18n/{en,vi}.json` — only `pipelineStudio.*` keys (+ the nav button label)
- This task file (`## Result`)

## Requirements

1. **Isolation.** All code, data, styles and the asset live in `features/pipeline-studio/`. The folder exports from `index.ts`: `PipelineStudioPage`, `PIPELINE_STUDIO_ENABLED` (a `const` boolean, default `true`) and `PipelineStudioNavButton`. Shell files import only from `features/pipeline-studio/index`. The page is lazy-loaded (like `WorkflowPage`). The module never calls RPC/sidecar — data is static.
2. **Hide/remove.** When `PIPELINE_STUDIO_ENABLED` is `false`, the settings button is not rendered and the `#pipeline-studio` hash falls back to the default route. Add a short `README.md` in the folder: how to hide (flag) and how to remove (delete folder + the listed touchpoints).
3. **Entry.** A small button at the bottom of the Settings section in `MainNav` ("Pipeline Studio", icon-like glyph allowed) navigates to `#pipeline-studio`. The studio page has a "← Back" control (and `Esc` when no panel/lightbox is open) that returns to the previous route.
4. **Full black page.** Page fills the viewport (`fixed inset-0`), background `#000`, no app chrome. Glow: nodes/edges use neon accents per group (desktop = blue, RPC runtime = amber, AI services = green, project workflows = rose, persistence = indigo) with `box-shadow`/`drop-shadow` glow; subtle animated background (dot grid or slow radial glow). Ignores the app light/dark theme — always black.
5. **Canvas = modules only.** Nodes and edges mirror the diagram: Studio user; Desktop app (Application shell, Settings views, Product views, RPC query hooks); RPC runtime (RPC client → Tauri transport → Tauri host → Sidecar process → Service container → RPC server); AI services (Chat and web chat, Model routing, Model providers, Model APIs); Project workflows (Workflow editor, Code pipeline, Pipeline state machine, Knowledge ingestion, Cost and budgets); Persistence (Event bus, Workspace access, Vector store, SQLite repositories, Embedding providers). Use the diagram's edge labels. Define nodes/edges in one typed data file with a short description and source file per node. Optional group backgrounds are allowed but keep the canvas uncluttered.
6. **Draggable.** Every node can be dragged; positions persist per viewer in `localStorage` (wrap every access in try/catch; render correctly without it). A "Reset layout" control restores defaults. Pan/zoom + Fit view work; the initial view fits every node.
7. **Data flow animation.** A "Run" control plays a simulated flow along the edges in topological order from Studio user: a glowing packet (dot) visibly travels along each edge (SVG `animateMotion` or CSS `offset-path`) to the next module; a module pulses while "processing" and, when done, shows a **check mark** badge with a smooth pop-in. Controls: Run / Pause / Reset; the run ends with every reached module checked. Edge stroke animates (dash flow) while active.
8. **Click → details.** Clicking a module (not dragging) opens a glowing side panel that slides in with: name, group, description, source file, incoming/outgoing connections (clickable to jump/select), and its run status. Close via ×, `Esc` or clicking the canvas.
9. **Full image.** A "View diagram" control opens a lightbox with the whole `architecture.png`, fit to screen, with zoom in/out/reset and drag-to-pan; close via ×/`Esc`/backdrop.
10. **Motion quality.** Transitions 150–400 ms with easing; nodes lift/scale slightly on hover; no layout jank. Respect `prefers-reduced-motion` (no travelling packets, instant check marks).
11. **A11y / conventions.** Controls are real buttons with labels (i18n en + vi), visible focus rings, panel/lightbox are `role="dialog"` with `aria-label`. No `dangerouslySetInnerHTML`, no default exports, no `any`.

## Tests (vitest + RTL, in the folder)

- data file: every edge references an existing node; graph from Studio user reaches every node except standalone ones (Model APIs may be a source — document it).
- flow runner (pure function/hook with fake timers): order is topological; Run→all checked; Pause stops progress; Reset clears checks; reduced-motion completes instantly.
- page: renders black full-screen container with all node names; clicking a node opens details with its connections; Esc closes; "View diagram" opens the lightbox with the image; drag-position persistence + Reset layout (mock `localStorage`, plus a throwing `localStorage`).
- shell: Settings button navigates to `#pipeline-studio` and the shell nav is not rendered there; with the flag `false` (mock the module) the button is absent and the hash falls back.

## Acceptance criteria

- [ ] All requirements met and covered by the tests above.
- [ ] Deleting `features/pipeline-studio/` and reverting the touchpoints is the full removal (described in README).
- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Hand-back

Append `## Result` per AGENTS.md §3.
