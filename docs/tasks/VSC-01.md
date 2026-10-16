# VSC-01 — Close the related VS Code windows when IT Studio or a project closes

Milestone: v1 owner acceptance feedback (2026-10-16) · Role: Implementer · Size M · **Deps pre-installed** · **Broad scope: `apps/sidecar/src/**` VS Code bridge/launcher/session files + container wiring, `apps/vscode-ext/src/**`, `apps/desktop/src/**` (project tab close / delete / app exit paths, VS Code settings section), `src/types/schemas.ts` (additive: bridge message, setting) and `apps/sidecar/src/validation/**` for them — do not stop for edits needed to meet a requirement; list them in Result**

## Owner request

"When I quit IT Studio, the VS Code windows related to Studio close too. When I close a project in Studio, the VS Code windows related to that project close automatically."

## Design (binding)

- **Never kill VS Code processes**: VS Code is single-instance, so killing a PID would close the owner's unrelated windows too.
- Close windows **through the IT Studio VS Code extension bridge**: the sidecar sends `close_window` to the extension session of that project's window, and the extension runs `workbench.action.closeWindow`. VS Code's own unsaved-changes prompt still protects edits; never force-close.
- Which windows: by default, windows that **IT Studio launched** for the project, i.e. the launcher started them and their extension session has that workspace root. Setting **"Also close VS Code windows I opened myself for that project"** (default off) extends this to any connected session whose workspace root equals the project root.

## Requirements

1. **Contract (additive):**
   - `SidecarToExt` gains `{ type: 'close_window'; ref: number; reason: 'studio_exit' | 'project_closed' | 'project_deleted' }`. The extension acks with the existing ack/ref mechanism; protocol version compatibility is kept, and older extensions ignore unknown types.
   - VS Code settings gain `closeWithStudio: boolean` (default `true`), `closeWithProject: boolean` (default `true`) and `closeManuallyOpened: boolean` (default `false`), normalised for old stored settings.
2. **Track ownership:** the launcher records `{ projectId, workspaceRoot, launchedAt }` for windows it started. When the extension's `hello` arrives with that root, mark the session `launchedByStudio`. Sessions are cleared on disconnect.
3. **Project closed (tab ×) or deleted** (`project.delete`): if `closeWithProject`, send `close_window` to the matching sessions (rule above). New RPC `vscode.closeForProject { projectId, reason }`, called by the desktop on tab close; the sidecar calls it internally on delete. Allow it to be fire-and-forget with a 3 s ack timeout; log the outcome.
4. **IT Studio exit:**
   - If `closeWithStudio`, before the sidecar shuts down (graceful `shutdown` RPC and stdin EOF path), send `close_window` with `studio_exit` to all matching sessions and wait up to 2 s for acks, then continue shutdown.
   - Must not delay exit beyond that.
   - On crash/kill this cannot run; that is acceptable and documented.
5. **Extension:** handle `close_window` by running `workbench.action.closeWindow`. If the window has unsaved changes, VS Code prompts. If the user cancels, ack `{ closed: false }`.
6. **UI:** Settings → VS Code gets the three toggles with short explanations, including "IT Studio never closes VS Code windows by force; unsaved work prompts as usual".
7. **Process tracking (PROC):** a `vscode_launch` process gets a final module `closed` or the existing `session` module output "closed by IT Studio (project closed)" when it closes.

## Tests (lean)

- Sidecar unit:
  - ownership tracking;
  - close on project close/delete uses the launched-only rule versus the manual-too setting;
  - exit path sends to all and waits ≤ 2 s with a fake clock;
  - no message when the toggles are off;
  - unknown/older extension ⇒ timeout logged, no crash.
- Extension unit: `close_window` triggers `workbench.action.closeWindow` and acks; a cancelled prompt acks `closed: false`.
- Desktop: tab close calls `vscode.closeForProject` when the setting is on; settings toggles persist.
- Integration: extend `vscode-bridge.test.ts` with a fake extension client that receives `close_window` on `project.delete` and on graceful shutdown.

## Acceptance criteria

- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass. QA runs `vscode-bridge` integration and a manual check with real VS Code: open two Studio projects, close one tab → only its window closes; quit Studio → the other closes; a manually opened unrelated VS Code window stays open.

## Hand-back

Append `## Result` per AGENTS.md §3.
