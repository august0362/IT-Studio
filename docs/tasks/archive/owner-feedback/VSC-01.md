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

## Result
- Summary: Implemented extension-mediated VS Code window closure for project tabs, successful project deletion, graceful shutdown and stdin EOF. Added per-window sessions and launch ownership, opt-in inclusion of manually opened project windows, persisted/defaulted close settings, UI explanations, bounded parallel acknowledgement waits (3 s for projects / 2 s for exit), outcome logging and final launch-process session output. No VS Code processes are killed; protocolVersion remains 1.
- Files changed:
  - `src/types/schemas.ts`: additive RPC, bridge message, optional acknowledgement outcome and three settings fields.
  - `apps/sidecar/src/container.ts`, `domain/default-settings.ts`, `services/settings-service.ts`, `services/vscode-bridge.ts`, `services/vscode-launcher.ts`, `validation/{ipc,settings,vscode}.ts` and adjacent service tests.
  - `apps/sidecar/src/services/web-chat-service.test.ts`: updated its typed settings fixture for the additive contract (required to keep the worktree compiling).
  - `apps/sidecar/test/integration/vscode-bridge.test.ts`: explicitly requested fake-extension integration cases for delete, shutdown and EOF.
  - `apps/vscode-ext/src/{actions,bridge,extension}.ts`, new `close-window.ts` and action/bridge/close-command tests.
  - `apps/desktop/src/shell/AppShell.tsx` and its tests; `features/settings/vscode/VSCodeSettingsPage.tsx` and new settings tests.
  - This task file (hand-back only).
- Dependencies added (with reason): None. Ran `npm.cmd --cache .npm-cache install` because node_modules was absent; no manifests or lockfile changed. Used the .cmd wrappers because PowerShell execution policy blocks npm.ps1.
- Decisions taken within scope:
  - Launch with `--new-window`, record project/root/time using the injected clock, and consume one ownership record per matching authenticated hello. Existing manually connected windows are not adopted. Session ownership and heartbeat state are cleared on disconnect; subsequent activation can launch again.
  - Keep `vscode_launch` active in its session module until the window closes. This is necessary because ProcessRegistry intentionally rejects module updates after a process has ended. Shutdown flushes the tracker after close outcomes.
  - Treat disconnect during a close request as successful closure because closing VS Code unloads the extension host. Retain timed-out requests for a late close after a long prompt, and clear them before shutting down the WebSocket transport.
  - VS Code's native close command returns void without a cancellation result ([upstream implementation](https://github.com/microsoft/vscode/blob/main/src/vs/platform/native/electron-main/nativeHostMainService.ts)). The extension allows 1 s for asynchronous host shutdown before acknowledging a surviving window as `closed: false`; explicit boolean outcomes are also respected. This grace period is inside the sidecar's exit deadline.
- Validation:
  - Formatted every changed TS/TSX file with Prettier (the canonical schemas file is excluded by the existing .prettierignore). `git diff --check` passes.
  - `npm.cmd --cache .npm-cache run typecheck`: passed, including the final repeat.
  - Final focused Vitest run: 9 files / 95 tests passed, covering ownership, project isolation, manual opt-in, disabled toggles, timeout logging, fake-clock 2 s shutdown bound, cancellation, late closure, real ProcessRegistry output, settings migration/persistence and desktop tab RPC.
  - Full direct Vitest run: 1555 passed, 1 skipped, 1 failed (untouched PipelineStudioPage fit-view test at 1280 x 600: 1366 > 1280). Its focused rerun, alongside CodePage and VS Code tests, passed (64 tests total); the full-suite failure is intermittent under load.
  - `npm.cmd --cache .npm-cache test`: stops in existing pretest secret-scanner self-tests because Git cannot read `C:/Users/admin/.config/git/ignore` (Permission denied); those tests require empty stderr. Ran the unit suite directly as above without changing tooling.
  - `npm.cmd --cache .npm-cache run test:integration -- apps/sidecar/test/integration/vscode-bridge.test.ts`: all 13 cases could not run to readiness because the sandbox causes tsx's `os.userInfo()` to fail with `uv_os_get_passwd` / ENOMEM; the standalone EOF case times out waiting for readiness. No tooling workaround applied.
  - `npm.cmd --cache .npm-cache run lint`: passed (Git emitted the same global-ignore permission warning, but the lint command exited 0).
- Open issues / follow-ups: QA must rerun the required checks and bridge integration outside the sandbox, and perform the task's real-VS-Code acceptance scenario including unsaved-work cancellation. The public close command does not expose prompt cancellation: `closed: false` means the host still exists after the grace period and can include a prompt still awaiting input. Verify long prompts and late save/close behavior manually. Crash/kill closure is unsupported by design and documented in the settings UI.
- Draft CHANGELOG entry (not applied because CHANGELOG.md is forbidden): Close related VS Code windows through the companion extension when their project or IT Studio closes, with ownership-aware settings and bounded shutdown waits (VSC-01).
