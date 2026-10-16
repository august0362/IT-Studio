# OWNER-FB1 — Owner feedback batch

Role: Implementer · Product: IT Studio (Tauri v2 + React 19 + Node 24 sidecar)

This batch supersedes UX-01. Work on branch `task/OWNER-FB1`, in package order **P1 → P5 → P2 → P4 → P3**. After each package, run `npm run typecheck`, `npm run lint`, and `npm test`; keep the tree green before starting the next package. If a package is blocked, record the exact reason and continue with the next package. Do not reuse the UX-01 branch.

## Owner authorization — 2026-10-04

The owner explicitly authorized editing all project files without the previous restrictions: “bạn có quyền sửa hết mọi thứ trong dự án mà không có ràng buộc”. This supersedes the path limits, QA-only migration step, protected-document limits, and P3 `unstable` stop condition below. Generate the P1 Drizzle migration, complete P5 wiring/contracts/UI, update P4's palette source/generator/startup catalog, and implement P3 child webviews with the required isolation. Parallel implementation is authorized. The earlier owner instructions also authorize committing and pushing the finished work to `https://github.com/august0362/IT-Studio.git`. Security requirements, additive compatibility, and required verification remain part of the implementation.

## Global rules

- Follow `AGENTS.md` and `../../../CONVENTIONS.md` strictly.
- Contracts are additive in `src/types/schemas.ts`; every new RPC method has a Zod validator under `apps/sidecar/src/validation/`. Existing equality tests must pass.
- No `any`, `@ts-ignore`, TS `enum`, default exports, `eslint-disable`, `shell: true`, raw SQL, or `dangerouslySetInnerHTML`. Secrets never enter UI state after save, logs, database rows, or error text.
- UI uses theme CSS tokens only, includes English and Vietnamese for new strings, is keyboard accessible, never communicates status by color alone, and respects `prefers-reduced-motion`.
- Keep product decisions, architecture, roadmap, engineering instructions and changelog consistent with the implemented batch.
- Commit and push to the owner's repository after verification, as authorized. Never reset unrelated work. Generate SQL migrations with Drizzle tooling.
- Add no npm dependencies. If a package truly requires one, stop that package and explain why in Result.
- Use no real network or real keychain in tests.

## Original scope and package requirements

The paths below describe the initial package boundaries. The owner authorization above permits required adjacent wiring, generation, migrations, tests and documentation.

### P1 — API keys: verify-before-save, progress, history, Google timeout

Scope: `src/types/schemas.ts` (additive contracts only); `apps/desktop/src/features/settings/api-keys/**`; `apps/desktop/src/i18n/en.json`; `apps/desktop/src/i18n/vi.json`; `apps/sidecar/src/services/secrets-service.ts` and its tests; `apps/sidecar/src/infra/http/provider-key-verifier.ts` and its tests; `apps/sidecar/src/providers/**` (list/verify paths only); `apps/sidecar/src/validation/**`; `apps/sidecar/src/container.ts` and its tests; `apps/sidecar/src/infra/sqlite/schema.ts`; `apps/sidecar/src/infra/sqlite/secret-history-repository.ts` and its tests. No hand-written migration files.

- Add `secrets.verifyAndSave({ provider, apiKey }) → SecretStatus`: validate the existing format rules, verify the candidate directly with its provider without storing it, then store only on success and append history. Failure stores nothing and leaves a previously saved key unchanged. Keep `secrets.set`, `secrets.verify`, and `secrets.delete` working.
- Add SQLite `secret_history` with id, provider, last-four-character hint, action (`saved | deleted | verify_failed`), nullable result code, and timestamp. Never persist the key. Add `secrets.history({ provider?, limit ≤ 50 }) → readonly SecretHistoryEntry[]` and its shared contract.
- Verify with at most one request per provider and a 25-second timeout. Map timeout to `PROVIDER_TIMEOUT` with remediation `The provider did not answer in time — check your network and try again; the key was not saved.` Map auth failures to `PROVIDER_AUTH` with remediation `The provider rejected this key.`
- Per provider row, add Verify & save and Delete buttons. During verification show a spinner and “Verifying…”, disable input/buttons. On success clear input, toast `<Provider> key saved ✓`, show `Verified · …1234`, and refresh history. On failure keep typed text, show the friendly error, and preserve the existing status. Empty input shows an inline hint without an RPC. Add a collapsible history section with time, provider, last four, and result.
- Tests: candidate verified before storage; failed candidate is not stored and old key remains; history contains no key material; one request per provider via MSW; timeout mapping; UI spinner, clearing, toast, error and status via fake RPC.

### P5 — Pricing: honest origin, working Update prices, seed check

Scope: `src/types/schemas.ts` (additive contracts only); `apps/sidecar/src/services/{pricing-updater,pricing-service}.ts`; `apps/sidecar/src/domain/default-settings.ts`; `apps/desktop/src/features/settings/pricing/**`; `config/pricing.seed.json`; `config/pricing.sources.json`; related English/Vietnamese i18n and tests.

- If `settings.pricing.extractionModelKey` has no stored key or is unusable, select the cheapest enabled chat + json-mode model whose provider has a stored key, using current input price. If none exists, `pricing.refresh` returns VALIDATION: `Add an API key first — price extraction needs one AI call (cost shown before running).`
- `pricing.refresh` returns per-provider outcomes: `applied`, `no_change`, `rejected_validation`, `fetch_failed`, or `extraction_failed`, each with a reason. The UI shows a result panel and toast summary; no silent failures.
- Above the table show last-updated date and honest origin (`seed (not verified)`, `auto`, or `manual`), warn while any row remains seed-origin, and provide a selector of only models with keys plus an estimated-cost line.
- Verify each model in `config/pricing.seed.json` against official pages in `config/pricing.sources.json` using the network. Update only prices that can be confirmed; leave the rest unchanged. In Result record each checked model’s official `sourceUrl` and verification date, and list entries that could not be confirmed. Never invent prices.
- Tests: fallback model selection; refresh outcomes including `extraction_failed`; UI warning, selector, and result panel.

### P2 — Workflow map: clean glowing nodes, moving data dots

Scope: `apps/desktop/src/features/workflow/**`, related English/Vietnamese i18n, and tests in those paths.

- Nodes show only module name and a status dot with text (`Idle`, `Active`, `Error`, `Disabled`). Move counters into the existing click-opened side panel.
- Render visible smooth-step edges. At rest use theme `border`; active use theme `primary`.
- Animate a small glowing dot along an edge for each activity event (~1.2 seconds). Queue multiple events. For reduced motion, highlight the edge without motion.
- Active nodes have a soft token-based glow and subtle pulse; error nodes have a `danger` token ring.
- React Flow background, controls, minimap, and panel use theme tokens only.
- Tests: node name/status only; batch-triggered edge animation with fake timers; reduced-motion behavior; counters remain in panel; unchanged layout snapshot.

### P4 — Frontend designer agent and glow dark themes

Scope: `.claude/agents/frontend-designer.md` (new); `docs/design/DARK-GLOW.md` (new); `src/types/schemas.ts` (additive `ThemeTokens` fields); `config/themes.json`; `apps/desktop/src/theme/**`; shared primitives only in `apps/desktop/src/components/**`; `apps/desktop/src/index.css`; theme contrast tests.

- Create the Claude Code subagent definition with frontmatter `name: frontend-designer`, a description, and tools `Read/Grep/Glob/Write/Edit`. Its instructions define a senior product UI designer for this repo, token-only styling, WCAG AA, i18n/accessibility, design briefs in `docs/design/`, and no business-logic edits.
- Write `docs/design/DARK-GLOW.md` describing warm near-black backgrounds, gold/amber accents and soft glow, thin luminous borders, subtle glass, large KPI numerals, glowing focus/hover, 12–16 px radius; additive tokens (glow, surfaceGlass, borderGlow, gradient stops); elevation/shadow scale; motion rules; and before/after guidance for card, button, input, table, tabs, nav, KPI tile, and chip.
- Add optional tokens with safe fallbacks for existing themes. Add at least three dark-native themes (Neon Gold, cyan, violet) with light counterparts. Upgrade shared primitives to use new tokens. Keep every theme/mode pair WCAG AA; extend tests to cover new tokens.
- Allow Neon Gold as the default dark theme, without otherwise changing default-theme selection logic; explain the choice in Result.
- Tests: all theme/mode contrast pairs, dark primitive snapshots, and token fallback.

### P3 — Web chat inside IT Studio: browser default and multi-webview spike

Scope: `apps/desktop/src-tauri/**`; `apps/desktop/src/features/webchat/**` (new); `apps/desktop/src/features/chat/WebChatMenu.tsx`; sidecar web-chat settings/service only to fix the browser default; `src/types/schemas.ts` (additive `webChat.layout`); related English/Vietnamese i18n, shell navigation, and tests.

- First fix Settings → Web chat so installed Cốc Cốc is shown and preselected rather than “System default”; persist the resolved choice on first load.
- Implement multi-webview support because provider sites block iframes. Use Tauri v2 child webviews; the owner has authorized the required Cargo `unstable` feature. Record any actual unavailable build dependency in Result.
- Security: children load only HTTPS URLs from the saved web-chat links; grant no Tauri IPC/capabilities and no sidecar access; use a data directory/profile separate from the main webview; block non-HTTPS navigation; send new-window requests to the external browser.
- UI: Web chat page with one to four panes, site selector, reload, open-in-browser, draggable resizable splitters with arrow-key control, and persisted layout/sites in `webChat.layout`. Keep app UI usable around panes.
- Show once: `Some providers (especially Google accounts) may block sign-in inside embedded browsers. If sign-in fails, use 'Open in browser' (Cốc Cốc).` Keep the existing Cốc Cốc menu action.
- Tests: layout settings validation; pane resize/persistence/keyboard behavior; Rust URL allow-check and empty capability set if feasible.

## Result

Completed P1–P5 under the owner authorization above. No npm dependencies were added.

### P1 — API keys

- Summary: Verify candidates before saving, use one provider request with a 25-second timeout, and expose masked action history with localized progress/errors/toast.
- Files changed: shared schemas/validators, API-key settings UI, secret service, verifier, SQLite schema/repository/migration, container and tests.
- Schema/DB: generated `0011_fair_mole_man.sql`, snapshot and journal using `npm run db:generate --workspace @itstudio/sidecar`. Real migrated SQLite tests cover table startup, idempotent migration, history roundtrip/filter/limit and production RPC wiring.
- Decisions: History contains only last four characters. Legacy RPCs remain. A history-write failure restores the previous key; failed restoration returns a sanitized recovery error, clears stale verification, and refreshes actual UI status.
- Tests: candidate verification order, old-key preservation, masking, request count/timeout, success/error/progress UI, save/delete recovery failures and SQLite integration.
- Follow-ups: no implementation blocker. No real keychain or provider network was used in tests.

### P5 — Pricing

- Summary: Added actual-key fallback selection, pre-run model choices/cost planning, explicit provider outcomes, per-row provenance, seed warnings and visible result summaries.
- Files changed: shared schemas/validators, pricing updater/service, composition root, pricing settings UI, source/seed config and tests.
- Schema/DB: additive provider-outcome/extraction metadata and optional entry/row origin. Origin persists in existing price JSON; no additional migration.
- Decisions: Choose the cheapest eligible enabled chat/json model with a stored key when the configured model is unusable. No-key validation happens before fetching. Reject the complete update batch on validation failure; preserve successful providers on fetch/extraction failure. Verify unchanged seed rows through provenance-only versions. Legacy missing origin is treated conservatively as seed.
- Cost planning: account for rendered metadata, page headings, user message, framing allowance and retry suffix. One UTF-8 byte is one conservative planning unit; truncate at complete character boundaries and check the request budget before dispatch. Plan two extraction attempts per provider. The displayed estimate is not a billing guarantee; router retries and actual usage can differ.
- Seed audit on 2026-10-04: every publicly confirmable represented price matched, so all numeric values stayed unchanged. Refreshed official source URLs. Retained single-tier seed values: Grok 4.6 short context (long-context $4/$12/$1 cached per MTok); Gemini 3.1 Pro Preview up to 200K (above that $4/$18/$0.40); Gemini Embedding 2 text inputs. Gemini 3.8 Flash confirmed rates apply through 2026-12-31 and are listed to double from 2027-01-01.
- Verified models and official sources (all checked 2026-10-04):
  - `anthropic/claude-opus-5-5`, `anthropic/claude-sonnet-5-5`, `anthropic/claude-haiku-4-5`: https://claude.com/pricing
  - `openai/gpt-5.5`: https://developers.openai.com/api/docs/models/gpt-5.5
  - `openai/gpt-5.3-codex`: https://developers.openai.com/api/docs/models/gpt-5.3-codex
  - `openai/gpt-5.4-mini`: https://developers.openai.com/api/docs/models/gpt-5.4-mini
  - `openai/text-embedding-3-small`: https://developers.openai.com/api/docs/models/text-embedding-3-small
  - `google/gemini-3.8-flash`, `google/gemini-3.1-pro-preview`, `google/gemini-embedding-2`: https://ai.google.dev/gemini-api/docs/pricing
  - `xai/grok-4.6`: https://docs.x.ai/developers/pricing
- Unconfirmed, unchanged: `xai/grok-4.1-fast` is absent from the current official page. Groq lists `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` as Contact Sales without public token rates.
- Tests: keyed selection, no-key early failure, five provider outcomes, atomic rejection/partial success, provenance persistence, unchanged seed verification, conservative ASCII/Unicode context plans and fake-RPC UI.
- Follow-ups: unconfirmed seed rows remain visibly unverified; live extraction was not run with paid provider keys.

### P2 — Workflow map

- Summary: Nodes show module name and status text/dot; counters remain in the detail panel. Smooth-step edges queue 1.2-second activity dots; reduced motion highlights edges. Active/error states and graph controls use theme tokens.
- Files changed: workflow graph/nodes/layout/store/edge/CSS/tests and English/Vietnamese translations.
- Schema/DB: none.
- Decisions: Hidden React Flow handles retain edge connections; activity queues use known edge IDs. Switching projects clears queued frames and ignores late graph/history/pagination responses; remaining concurrent calls keep the node Active after one completion.
- Tests: node/status content, counters in panel, queued event motion, reduced motion, layout snapshot, minimap accessibility, project response/history isolation and concurrent completion (17 focused workflow tests).
- Follow-ups: none.

### P4 — Themes and designer

- Summary: Added the frontend designer agent, DARK-GLOW brief, optional glow/glass/border/gradient tokens, shared themed primitives and three new palettes with light/dark modes.
- Files changed: `.claude/agents/frontend-designer.md`, `docs/design/DARK-GLOW.md`, shared token schema/validator, palette PNGs, theme generator/catalog/startup map, theme settings, CSS, primitives/components and tests.
- Schema/DB: additive optional theme tokens with safe fallbacks; no DB migration.
- Decisions: Neon Gold is the default dark theme. Saved theme choice still wins; system/light selection retains existing behavior. All 18 legacy definitions are preserved and 3 new themes produce a total of 21. Source palettes drive deterministic generation, including pre-React startup data.
- Tests: 42 theme/mode contrast pairs including glass/gradient/hover, applied-token primitive snapshots, fallback, startup cache/default/corrupt cache and deterministic generation.
- Visual review: native Theme Settings screenshots for Neon Gold, Neon Cyan and Neon Violet dark modes were inspected. Text, borders and accent states are readable in the captured settings views. Full-page, dialog and backdrop review remains a follow-up.

### P3 — Embedded web chat

- Summary: Cốc Cốc first-load default and a Web chat route with 1–4 native child webviews, saved-site selection, reload/open-in-browser, pointer/keyboard splitters and persisted layout.
- Files changed: Tauri Cargo/build/commands/capability/permissions/native webchat module/tests; frontend webchat route/host/layout/native hook/settings/shell; shared settings contracts/validators/reconciliation and tests; translations.
- Schema/DB: optional `webChat.layout` with 1–4 enabled saved IDs and matching fractions (minimum 10%, sum 1). Existing settings need no migration.
- Decisions: Enabled Tauri's `unstable` feature under owner authorization. Native commands enforce the caller label `main`; capability permissions explicitly select only the main webview. Children use saved HTTPS origins, deny credentials/local hosts/non-HTTPS navigation, and have separate webchat profiles. Safe HTTPS popups open externally. No child capability or sidecar access is granted.
- Lifecycle: clip bounds to the main viewport, hide during drag/dialogs while retaining sessions, retain offscreen slots, and close removed/changed sites or all children on route unmount. Hash navigation also waits for native cleanup; shell banners trigger remeasurement. A serialized host prevents delayed sync from recreating closed panes.
- Settings: first-load browser resolution preserves later explicit System default. The site-settings form omits layout from its patch so disable/delete/reset triggers backend layout reconciliation. Existing external Cốc Cốc action remains. URL validation agrees across sidecar/Rust on public hosts and the raw/normalized 2,048 UTF-8 byte limit. Native IDs remain compatible with custom saved IDs. Prefixed profile paths avoid Windows device names; long hosts use a stable suffix to stay within a 122-byte component.
- Tests: browser default, 1–4 layout validation, missing/disabled IDs, resize minima/persistence/keyboard, clipping/pause/cleanup, command errors/host lifecycle, Rust URL/bounds/slot/navigation/caller/capability checks.
- Follow-ups: native provider sign-in, popup and visual resize smoke remain to be reviewed. Some sites may block embedded sign-in; the page provides a once-only warning and Open in browser.

### Final verification

The final integration audit also updates E2E key selectors/verifier sessions and the 21-theme expectations. Native shell testing exposed an inherited navigation selector that hard-coded the English aria-label after switching to Vietnamese; the E2E helpers now use locale-independent navigation selectors. A Windows lint failure was traced to passing 33,912 characters of filenames to a child command (ENAMETOOLONG). The lint script now invokes the existing scanner's own Git discovery, with deduplication/deleted-file handling and black-box regressions for long filename lists and masked fixture reporting. No dependency or lockfile change was needed.

- Scoped Prettier was run before verification; no repository-wide formatting was used.
- `npm run typecheck`: passed (root, desktop, sidecar, extension, integration/E2E TypeScript).
- `npm run lint`: passed after the Windows invocation fix; includes full ESLint, Prettier check and secret scan.
- `npm run lint:selftest`: passed, including all four scanner regressions and masked forbidden-secret fixture reporting.
- Rust: `cargo test --lib --locked` passed (28 tests); `cargo check --locked`, `cargo clippy --lib --locked -- -D warnings` and formatting passed.
- Integration: initial full run passed 113/114 tests in 17/18 files. The one stale fetch-failure precondition was corrected to configure a fake extractor key; the affected pricing suite then passed 7/7, including a new no-key boundary. No full integration rerun was needed; all affected cases were rechecked.
- `npm run build:app`: passed. SEA sidecar 96,285,696 bytes; NSIS 93,349,875 bytes; MSI 147,868,368 bytes. Migration 0011 is present in both SEA and Tauri runtime resources. All 52 tracked icons were restored to their exact prebuild bytes.
- `npm run smoke:sidecar`: passed in an isolated rerun (554 ms readiness, ping and graceful shutdown). The first run reached ready in 2,114 ms during concurrent artifact hashing and failed the 1,500 ms timing target; that measurement is retained rather than treated as a passing run.
- Fresh debug `tauri build --debug --no-bundle`: passed; executable built at 2026-10-04T13:26:14.611Z, SHA-256 `986623B8C7236BBFA4A5A502EA32B7E38C882DE19904D48E80EFE4CF3B1E264F`.
- Installer SHA-256: NSIS `1E07D1A576B6829AB52B6A901C19E88FAEC9476BD22C7F9F6C866F61958418E0`; MSI `BCA6CC5A4C0B5EE433D2CECF05DD68418C1D3A633E1697A8A3EB480EC8064E59`.
- `npm test`: passed in the final isolated run (1,030 Vitest tests passed, 1 existing skip; 141 passed files and 1 skipped file; 6 Node build/release tests passed). Earlier runs during concurrent builds hit unrelated PDF/chat timing limits; both passed individually and in this final full run, without altering their tests or tooling.
- Focused native E2E and screenshot review results are recorded below after completion.
- Historical scope/migration/unstable blockers are resolved. Remaining release checks concern real embedded-provider sign-in/pane visuals and isolated installer smoke/M9-QA, not permission to implement the batch.
- Installer smoke was not run on this batch. The existing `smoke:install` script isolates installation/Node lookup but still launches release against the user's actual appdata/keychain. Runtime-data/keychain isolation must be arranged before using it for the next automated release gate.


## QA (Claude) — final, 2026-10-14

- Merged current `main` (M9 sign-off, M9-FIX2…7, QA-E2E-FIX4) into the branch. Conflicts resolved: `e2e/wdio.conf.ts` (kept the per-worker drivers from QA-E2E-FIX4; the verifier-timeout session for `m1/startup.spec.ts` moved to port 4452 because 4450 is used by `m4/scripted-llm.spec.ts`), `CHANGELOG.md`, `docs/RUNNING.md`, `docs/HANDOFF.md`.
- Governance: the edits to `AGENTS.md` and to the development-pipeline rows of `../../../CONTEXT.md` were reverted. The Architect/QA (Claude) and Implementer (Codex) split of `../../../ROLES.md` stays in force. Product decision updates (D12, D17, D34) and ADR-0005 are kept.
- Stale E2E assertions after intended UI changes: TC-M4-044 (the user-facing text no longer carries the internal "D31:" prefix) and TC-MW-010 (24 h counters moved from the node to the module panel's Metrics tab, P2). Both specs were updated; no product change.
- Gates: typecheck ✔, lint ✔, unit 1 041 passed + 1 skipped ✔, Rust 28/28 ✔, integration 115/115 ✔, full E2E 14 specs: 11 passed on the first run, TC-M1-041 was a WebDriver session flake (passes alone), TC-M4-044 and TC-MW-010 pass after the assertion updates.
- Remaining native follow-ups (not blocking): embedded provider sign-in/popups in real accounts and a full-page visual review of the three Neon themes; owner hands-on check.
- Verdict: **accepted and landed**.
