# QA-E2E-FIX6 — Locale-independent settings navigation helper

Role: Implementer · Size XS · Model: gpt-6-luna medium · **Deps pre-installed** · Scope: `e2e/helpers/ui.ts` (+ any spec using `nav[aria-label="Main navigation"]`), this task file.

## Problem (QA, full E2E 13/14)

`m4/shell.spec.ts` TC-M4-011 fails after switching the UI to Vietnamese: `openSettings()` clicks `nav[aria-label="Main navigation"] a[href="#settings"]`, but the nav's `aria-label` is translated ("Điều hướng chính"), so the element is not found.

## Fix

In `e2e/helpers/ui.ts` select the sidebar link by `href` only, e.g. `nav a[href="#settings"]` (first match), and replace every other `nav[aria-label="Main navigation"]` selector in `e2e/**` with a locale-independent one (href or `data-testid` that already exists). No product change.

## Acceptance criteria

- [ ] `npx prettier --write` changed files; `npm run typecheck` and `npm run lint` pass. QA reruns E2E `m4/shell.spec.ts`.

## Result
- Summary: Replaced translated navigation-label selectors with href-based selectors across E2E helpers and specs.
- Files changed: `e2e/helpers/ui.ts`, `e2e/specs/m4/chat.spec.ts`, `e2e/specs/m4/cost.spec.ts`, `e2e/specs/m4/scripted-llm.spec.ts`, `e2e/specs/m4/settings.spec.ts`, `e2e/specs/m5/knowledge.spec.ts`, `e2e/specs/m6/code.spec.ts`, `e2e/specs/m8/images.spec.ts`.
- Dependencies added (with reason): None.
- Decisions taken within scope: Kept the existing hrefs and removed the translated `aria-label` constraint.
- Open issues / follow-ups: `npm run typecheck` and `npm run lint` pass. `npm test` fails in the unrelated `scripts/scan-secrets.test.mjs` suite because Git emits a permission warning for `C:\Users\admin/.config/git/ignore` into stderr; all four tests expecting clean stderr fail. QA should rerun E2E `m4/shell.spec.ts`.
