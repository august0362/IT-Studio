# images

Image generation (M8): DALL-E 3 and FLUX providers, budget pre-checks, ledger entries, stored assets. Chat calls
it through the `generate_image` tool.

- **RPC:** `images.list`, `images.delete` (generation runs through chat and the process registry).
- **Depends on:** kernel (image providers, secret store port), `settings`, `cost` (budget, prices, ledger
  repository, cost text), `workflow` (activity events).
