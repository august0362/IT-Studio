# M8 — Test Case Specification (image generation)

> QA gate `M8-QA` · Author: QA (Claude) · 2026-10-04 · Lean QA (`lean-qa`): cover the gaps only.
> Levels: L1/L2 unit · L3 real sidecar with `ITSTUDIO_E2E=1` fake image provider and scripted tool calls · L4 real app (windows allowed).
> Status: **exists** / **new**.

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M8-001 | Scripted `generate_image` tool call | asset stored + listed, ledger `image` row, assistant `image` part | L3 | P1 | exists |
| TC-M8-002 | Hard Stop | no provider call, no file, `BUDGET_HARD_STOP` | L3 | P1 | exists |
| TC-M8-003 | Provider fallback | primary image provider `http:503` → second provider used; ledger row names the fallback provider | L3 | P1 | new (scripted image provider outcomes like `ITSTUDIO_E2E_EMBEDDING_SCRIPT`) |
| TC-M8-004 | Image generation disabled | tool not declared to the model; a forged tool call is rejected | L3 | P1 | new |
| TC-M8-005 | Path safety | asset ids / file names never derived from model input; `images.path` (if present) rejects ids outside the images dir | L2 | P1 | exists — verify |
| TC-M8-006 | Delete | `images.delete` removes file + row, ledger unchanged (append-only) | L3 | P2 | new |
| TC-M8-007 | Asset protocol scope | config grants only `$APPDATA/com.itstudio.app/images/**`; opener allowed only for that directory | L1 | P1 | exists — verify |
| TC-M8-010 | Chat shows generated image | enable images in Settings → scripted tool call → image renders inline, lightbox opens | L4 | P1 | new |
| TC-M8-011 | Gallery | asset appears with prompt + cost; delete with confirm removes it | L4 | P1 | new |
| TC-M8-012 | Settings → Images | toggle persists after reload; provider order keyboard reorder persists | L4 | P2 | new |

Coverage gates: `image-service.ts` ≥ 90 % branches; adapters ≥ 90 % (measured 90–94 %).
