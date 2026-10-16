# OWNER-FB2-B — Desktop: folder picker, project history, chat "thinking" indicator

Milestone: v1 owner acceptance feedback (2026-10-16) · Role: Implementer (ROLES §1.3) · Size M · **Deps pre-installed** (`@tauri-apps/plugin-dialog` ~2.8.1, Rust plugin registered, capability `dialog:allow-open`) · **Contracts committed** (`project.delete`, `Project.lastOpenedAt`) — sidecar side is OWNER-FB2-A, work against the contract with the fake RPC in tests · **Broad scope inside `apps/desktop/src/**`: do not stop for edits needed to meet a requirement — list them in Result**

## Owner report

1. New project: "Folder path" must be typed by hand — there must be a button to pick the folder.
2. There is no history of projects: the owner wants every project listed, reopen it like normal, and delete projects.
3. After sending a chat message nothing shows until the answer arrives — needs a moving "loading dots" indicator.

## Scope

- `apps/desktop/src/**` (+ tests): `shell/NewProjectDialog.tsx`, `shell/{AppShell,MainNav,ProjectTabs}.tsx`, new `features/projects/**`, `features/chat/**`, `i18n/{en,vi}.json` (new keys).
- This task file (`## Result`).

## Requirements

1. **Folder picker.** Next to *Folder path* add a button "Browse…" (folder icon + text, labelled). It calls `open({ directory: true, multiple: false, title })` from `@tauri-apps/plugin-dialog` and fills the field with the chosen absolute path; cancel leaves the field unchanged. If *Name* is empty, prefill it with the folder's last segment. Typing by hand still works. Wrap the plugin call in a small module (`shell/pick-folder.ts`) so tests mock it.
2. **Projects page (history).** New main-nav entry **Projects** (above Chat), route `projects`:
   - List every project from `project.list` (already ordered by last opened): name, folder path (read-only, truncated with tooltip), last opened ("never" if absent), created.
   - Search box filters by name or path.
   - Row actions: **Open** — opens/activates the tab via the existing `project.setActive` flow and navigates to Chat. **Delete** — confirm dialog: "Delete *Name* from IT Studio? Its chats, pipeline runs, knowledge index, images and cost records are removed. Files in *path* are not touched." The confirm button is red. Calls `project.delete`. On `CONFLICT`, show "A pipeline is running in this project — cancel it first". Remove the tab if it was open; refetch the list.
   - Empty state with a "New project" button (opens the existing dialog).
   - Closing a tab (×) only hides it; the project stays in Projects. Make that clear with tooltip "Close tab (project stays in Projects)".
3. **Restore open tabs** across restarts: persist open project ids and the active id in `localStorage` (try/catch; drop ids that no longer exist).
4. **Chat thinking indicator.** After *Send*, show an assistant bubble with three animated dots and the label "Thinking…" / "Đang trả lời…" until the first delta arrives. While streaming, show a blinking caret at the end of the text. Remove both on completion, error or Stop. The Stop button stays available. `prefers-reduced-motion`: static dots, no animation. Announce with `aria-live="polite"` and `role="status"`.
5. **Error panel.** When an error carries remediation lines, keep showing them as today. No change is needed beyond rendering the new sidecar texts.

## Tests (lean, RTL + fake RPC)

- Browse fills the path, prefills an empty name and leaves the field on cancel (mock `pick-folder`).
- Projects page: list order and fields; search; Open activates and navigates; Delete confirm → `project.delete` → row and tab removed; `CONFLICT` message; empty state.
- Tab restore from `localStorage` (normal and throwing storage).
- Chat: dots appear after send and disappear on the first delta, error and Stop; caret while streaming; reduced motion.

## Acceptance criteria

- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Hand-back

Append `## Result` per AGENTS.md §3.

## Result

- Summary: Added native folder browsing with name prefill, searchable project history with Open/Delete and pipeline-conflict handling, persisted tabs and active selection, and accessible chat thinking dots/streaming caret with reduced-motion support. Stop removes activity indicators immediately and preserves partial text. Error remediation remains visible.
- Files changed: `apps/desktop/src/shell/{AppShell,MainNav,NewProjectDialog,ProjectTabs}.tsx`, `shell/pick-folder.ts`, `shell/{AppShell,NewProjectDialog}.test.tsx`; new `features/projects/ProjectsPage.tsx`; `features/chat/{ChatPage,MessageList,ThinkingIndicator}.tsx`, `features/chat/chat-store.ts`, `features/chat/streaming.css`, chat page/indicator tests; `state/open-projects.ts`; `i18n/{en,vi}.json`; this task file.
- Dependencies added (with reason): None. Restored the pre-installed dependency set with `npm.cmd --cache .npm-cache install` because `node_modules` was absent; manifests and lockfile are unchanged.
- Decisions taken within scope: Extended the existing `state/open-projects.ts` helper under the task's broad desktop scope to persist active selection (including All projects), wait for loaded data before saving, and discard missing IDs. Preserve tab order independently of history ordering. Restore a saved active project through `project.setActive` when it differs from sidecar settings. Folder picker failures retain manual entry. A Stop before send acknowledgment cancels once the request ID arrives; late events cannot restart a stopped bubble.
- Validation: Formatted changed files through `npm.cmd --cache .npm-cache exec -- prettier --write`; `npm.cmd --cache .npm-cache run typecheck` and `npm.cmd --cache .npm-cache run lint` passed. The complete Vitest run passed (160 files, 1,405 tests; one file/test skipped); all 26 release/build/dev script tests passed. Tests use fake RPC and a mocked folder picker.
- Open issues / follow-ups: `npm.cmd --cache .npm-cache test` stops in pretest: four existing secret-scanner regression tests expect empty stderr, but sandbox Git prints `warning: unable to access 'C:\Users\admin/.config/git/ignore': Permission denied`. Ran the underlying complete Vitest suite and script tests separately, without modifying tooling. QA should rerun the standard command outside this sandbox.
- Changelog draft: Add folder browsing, project history and tab restoration, and accessible chat thinking/streaming feedback (OWNER-FB2-B).
