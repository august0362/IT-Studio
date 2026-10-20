# router

LLM routing: provider adapters, the seeded model registry, budget-aware model ladders with circuit breakers and
user-confirmed fallbacks, and the `completed` bus that the ledger and knowledge modules listen to.

- **RPC:** `router.getConfig`, `router.updateConfig`, `router.resolveFallback`, `models.list`.
- **Depends on:** kernel (providers, secret store port), `settings` (router config), `cost` (budget guard, prices,
  FX rate for fallback cost hints).
