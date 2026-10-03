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
