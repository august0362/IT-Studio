# workflow

Workflow map (D32): the internal activity bus that chat, knowledge, images, pipeline and VS Code publish to, and
the activity recorder that builds the per-project module graph and activity log.

- **RPC:** `workflow.graph`, `workflow.activity`.
- **Depends on:** kernel, `settings` (workflow settings), `cost` (FX rate for aggregated costs).
