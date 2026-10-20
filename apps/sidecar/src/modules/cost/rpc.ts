import type { RpcServer } from '../../kernel/rpc/rpc-server.js';
import type { CostModule, PricingUpdater } from './index.js';

export function registerCostRpc(server: RpcServer, cost: CostModule, updater: PricingUpdater): void {
  const { fx, ledger, pnl, revenue, budget, pricing } = cost;
  server.register('fx.get', () => fx.get());
  server.register('fx.override', ({ usdToVnd }) => fx.override(usdToVnd));
  server.register('ledger.query', (query) => ledger.query(query));
  server.register('ledger.queryRows', (query) => ledger.queryRows(query));
  server.register('pnl.get', ({ projectId, from, to }) => pnl.get(projectId, from, to));
  server.register('pnl.getAll', ({ from, to }) => pnl.getAll(from, to));
  server.register('revenue.add', (input) => revenue.add(input));
  server.register('revenue.list', ({ projectId, from, to }) => revenue.list(projectId, from, to));
  server.register('revenue.listRows', ({ projectId, from, to }) => revenue.listRows(projectId, from, to));
  server.register('budget.set', ({ projectId, period, limitMicroUsd, warnAt }) =>
    budget.set({ projectId, period, limitMicroUsd, warnAt }),
  );
  server.register('budget.setUsd', (input) => budget.setUsd(input));
  server.register('budget.status', ({ projectId }) => budget.status(projectId));
  server.register('pricing.get', () => Promise.resolve({ ok: true, value: pricing.current() }));
  server.register('pricing.getRows', async () => {
    const rate = fx.getEffective();
    const extraction = await updater.extractionOptions(rate);
    if (!extraction.ok) return extraction;
    return { ok: true, value: { ...pricing.getRows(rate), extraction: extraction.value } };
  });
  server.register('pricing.override', ({ entry }) => Promise.resolve(pricing.override(entry)));
  server.register('pricing.overrideUsd', (input) => Promise.resolve(pricing.overrideUsd(input)));
  server.register('pricing.clearOverride', ({ modelKey }) => Promise.resolve(cost.clearPriceOverride(modelKey)));
  server.register('pricing.refresh', () => updater.refresh());
}
