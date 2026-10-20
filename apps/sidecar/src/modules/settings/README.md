# settings

App settings, provider API keys (keychain + masked history + live verification) and the sidecar system service
(`system.ping`, `system.shutdown`, version, shutdown hooks).

- **RPC:** `settings.get`, `settings.update`, `secrets.set`, `secrets.delete`, `secrets.status`, `secrets.verify`,
  `secrets.verifyAndSave`, `secrets.history`; `system.*` via `SystemService.register`.
- **Depends on:** kernel only (process tracker port, secret store port, SQLite repositories, key verifier).
