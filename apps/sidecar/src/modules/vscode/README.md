# vscode

VS Code companion: the local WebSocket bridge to the IT Studio extension (status, diagnostics, reveal/diff,
user saves) and the launcher that installs the extension and opens one window per active project.

- **RPC:** `vscode.closeForProject`; `project.setActive` / `project.delete` (projects module) open and close
  windows through this module.
- **Depends on:** kernel (process tracker port, code CLI runner), `settings` (VS Code settings), `workflow` (activity
  events).
