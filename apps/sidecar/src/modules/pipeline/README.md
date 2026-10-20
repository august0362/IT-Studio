# pipeline

Code pipeline (M6): PM → Coder → Reviewer role ladders, crash-safe write transactions into the project
workspace, validation commands, failure reports, and startup recovery of interrupted transactions and runs.

- **RPC:** `pipeline.start`, `pipeline.get`, `pipeline.list`, `pipeline.cancel`, `pipeline.answerClarifications`.
- **Depends on:** kernel (process runner, path guard, parsers), `settings` (pipeline settings), `router` (LLM
  router and model eligibility), `cost` (run cost, budget hard stop), `projects` (repository and context),
  `workflow` (command activity and run correlation).
