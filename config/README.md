# config/ — seed configuration (owned by Architect)

Loaded by the sidecar at first run and validated with zod (task M1-01). After first run, live values live in SQLite and are changed through Settings / RPC; these files are only seeds and fallbacks.

| File | Type (`schemas.ts`) | Notes |
|---|---|---|
| `models.seed.json` | `{ models: ModelDescriptor[]; defaultLadder: LadderEntry[]; defaultRoleAssignment: RoleAssignment; defaultEmbedding: EmbeddingConfig; defaultPricingExtractionModel: ModelKey }` | Model ids verified against provider `/models` endpoints in M2-05 (Q-02). Context-window / max-output numbers are provisional until then. |
| `pricing.seed.json` | `PriceTable` | Collected 2026-10-01. Anthropic and Google from official pages; OpenAI, xAI, Groq from secondary aggregators (official pages blocked automated fetch) — **treat as provisional**; M3-04 auto-update replaces them. Cached-input prices for Google/OpenAI-mini/xAI-fast assumed at 10 % of input. Groq has no cache discount (cached = input). Free tiers are metered at paid rates (conservative). |
| `pricing.sources.json` | `Record<ProviderId, string[]>` | Pages fetched by the pricing updater. |
| `commands.default.json` | `CommandSpec[]` | Default validation commands. `executable: "node"` is resolved by the runner to `process.execPath` (Windows cannot spawn `npm.cmd` with `shell:false`; tools are run via their JS entry points). |
| `fx.json` | sidecar-internal `FxConfig` | `seedUsdToVnd` used only until the first successful fetch (Q-03). |

Embedding note: `text-embedding-3-small` and `gemini-embedding-2` are both requested at 1536 dimensions (both support configurable output dimensionality) so they can fall back to each other without re-indexing — verify in M5-03.
