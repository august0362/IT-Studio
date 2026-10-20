# projects

Projects: create, list, activate and delete (with its knowledge vectors, files and activity), plus the project
context (tree, conventions) that the pipeline and web chat put into prompts.

- **RPC:** `project.list`, `project.create`, `project.setActive`, `project.delete`.
- **Depends on:** kernel, `settings` (active project), `knowledge` (vector store, for deletion), `vscode` (open
  and close windows). The pipeline and workflow callbacks are passed in by the composition root.
