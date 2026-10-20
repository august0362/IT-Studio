# processes

Process registry (Processes page): tracks every long-running operation, persists it, and cancels or retries it
through the owning module.

- **RPC:** `process.list`, `process.get`, `process.cancel`, `process.retry`, `process.dismiss`, `process.delete`,
  `process.report`.
- **Depends on:** kernel only. Retries call back into the owning modules through the `handlers` the composition
  root passes in (chat, pipeline, knowledge, images, cost, settings).
