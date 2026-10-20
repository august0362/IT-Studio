# cost

Money: FX rates (daily refresh), the price table and its LLM-assisted refresh, the request ledger, budgets,
revenue and P&L. Exposes `costText` / `moneyDisplay` for process cards and run costs in other modules.

- **RPC:** `fx.*`, `ledger.*`, `pnl.*`, `revenue.*`, `budget.*`, `pricing.*`.
- **Depends on:** kernel, `settings` (FX and budget settings), `router` (the model catalog and its `completed`
  bus; the pricing updater uses `LlmRouter` and is built after the router).
