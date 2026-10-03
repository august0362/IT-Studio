# M4-FIX3 — Clear a manual price override (D9 gap)

Role: Implementer (ROLES §1.3) · **Deps pre-installed** · Found by QA-E2E-FIX1 round 3: Settings → Pricing has no way to clear a manual override, although D9 says manual prices win "until the user clears them". `PricingService.clearOverride(modelKey)` already exists in the sidecar.

## Scope
- `src/types/schemas.ts` (additive: `'pricing.clearOverride': { params: { readonly modelKey: ModelKey }; result: PriceTable };`), `apps/sidecar/src/validation/**`, `apps/sidecar/src/container.ts` (1 `server.register` line), `apps/sidecar/src/services/pricing-service.ts` (+ test, only if needed)
- `apps/desktop/src/features/settings/pricing/**` (+ tests), `apps/desktop/src/i18n/{en,vi}.json` (new keys only)
- `e2e/specs/m4/settings.spec.ts` (TC-M4-043 teardown: use the new action instead of re-entering seed prices)

## Requirements
1. RPC `pricing.clearOverride({modelKey})` → new price-table version without that model's manual override (the model falls back to the latest auto/seed price); unknown model or no override → `VALIDATION` with remediation; publishes `pricing.updated`.
2. UI: rows with the "overridden" badge get a **Clear override** action (in-app `ConfirmDialog`), refreshing `pricing.getRows`.
3. Tests: service + RPC validation; component test for the action; TC-M4-046 (L4, written, not run) clears an override and the badge disappears.

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0. Do not run E2E.

## Hand-back
Append `## Result` per AGENTS.md §3.

## Result
- Summary: Added the `pricing.clearOverride` RPC, validation, `pricing.updated` notification, price restoration, a confirmed UI action, and TC-M4-046. TC-M4-043 teardown now clears the override.
- Files changed: `src/types/schemas.ts`; `apps/sidecar/src/validation/ipc.ts`; `apps/sidecar/src/validation/validation.test.ts`; `apps/sidecar/src/container.ts`; `apps/sidecar/src/services/pricing-service.ts`; `apps/sidecar/src/services/pricing-service.test.ts`; `apps/desktop/src/features/settings/pricing/PricingSettingsPage.tsx`; `apps/desktop/src/features/settings/pricing/PricingSettingsPage.test.tsx`; `apps/desktop/src/i18n/en.json`; `apps/desktop/src/i18n/vi.json`; `e2e/specs/m4/settings.spec.ts`.
- Dependencies added (with reason): None. Ran `npm --cache .npm-cache install` because `node_modules` was absent; no dependency manifests changed.
- Decisions taken within scope: Clearing an override creates a new manual price-table version and restores the tracked automatic price, falling back to the seed price. The current price repository interface exposes only the latest table, so after a restart with a manual override it cannot recover a prior automatic price; the seed is used for that model.
- Open issues / follow-ups: Persist or query the latest automatic baseline for overridden models if clearing after restart must restore a more recent automatic price than the seed. `typecheck`, `lint`, and `test` pass; E2E was not run as instructed.
