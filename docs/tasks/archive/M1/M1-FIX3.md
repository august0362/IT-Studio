# M1-FIX3 — Accessible in-app confirm dialog (BUG-M1-005)

Milestone: M1 · Depends on: M1-07 · Role: Implementer (ROLES §1.3) · **Deps pre-installed**

## Defect
**BUG-M1-005** (S3, product): Settings → API Keys "Delete" uses native `window.confirm`. Under Tauri/WebView2 the native dialog cannot be cancelled with Esc via the app's keyboard flow, is unthemed, and is not testable — in E2E TC-M1-040 pressing Esc after Delete **deleted the key**. M1-07 requires a keyboard-accessible confirm dialog (Esc cancels).

## Scope
- `apps/desktop/src/components/ui/ConfirmDialog.tsx` (+ test), `apps/desktop/src/features/settings/api-keys/**`, `e2e/specs/m1/api-keys.spec.ts` (TC-M1-040 only)

## Requirements
1. Reusable `<ConfirmDialog open title message confirmLabel cancelLabel tone="danger" onConfirm onCancel />`: `role="alertdialog"`, `aria-modal="true"`, labelled/described by title/message, focus moves to **Cancel** on open, focus trapped (Tab/Shift+Tab cycle), **Esc = cancel**, click on backdrop = cancel, focus returns to the triggering button on close. Styling via the existing neutral class constants (theme tokens arrive in M4-01b).
2. Replace every `window.confirm` in the desktop app with `ConfirmDialog` (grep must find none).
3. ESLint guard: add `no-restricted-globals`/`no-restricted-properties` for `window.confirm`, `window.alert`, `window.prompt` in `apps/desktop/src/**` — **edit only that rule block in `eslint.config.js`** (allowed for this task).
4. Update TC-M1-040 to open the dialog, press Esc, assert the dialog closed and the status is still `Set`; then Delete → confirm via keyboard (Tab to confirm, Enter) → `Not set`.

## Tests
- Component tests: open/close, Esc cancels, backdrop cancels, focus trap, focus return, confirm calls `onConfirm` once; ApiKeysPage delete flow with cancel and confirm.

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0; no `window.confirm|alert|prompt` in `apps/desktop/src`
- [ ] QA re-runs TC-M1-040 E2E outside the sandbox

## Hand-back
Append `## Result` per AGENTS.md §3.

## Result
- Summary: Added a reusable accessible confirmation dialog and replaced the API key delete browser confirmation. Updated the ESLint guard and TC-M1-040 keyboard flow.
- Files changed: `apps/desktop/src/components/ui/ConfirmDialog.tsx`, `apps/desktop/src/components/ui/ConfirmDialog.test.tsx`, `apps/desktop/src/features/settings/api-keys/ApiKeysPage.tsx`, `apps/desktop/src/features/settings/api-keys/ApiKeysPage.test.tsx`, `eslint.config.js`, `e2e/specs/m1/api-keys.spec.ts`.
- Dependencies added (with reason): None.
- Decisions taken within scope: The dialog restores focus to the element focused before it opened; delete remains pending until confirmation.
- Open issues / follow-ups: QA must rerun TC-M1-040 in the E2E environment. E2E was not run in this sandbox.

## QA (Claude)
- Gates: typecheck ✔, lint ✔ (incl. new no-native-dialog guard), 308 tests ✔, no `window.confirm|alert|prompt` in apps/desktop/src ✔. E2E TC-M1-040 verified by QA after merge (see M1 report).
