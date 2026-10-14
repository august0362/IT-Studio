# ADR-0005 — Owner feedback: theme defaults and isolated embedded web chat

- Date: 2026-10-04
- Status: Accepted by owner instruction
- Work order: `docs/tasks/OWNER-FB1.md`

## Context

The owner requested glow themes, reliable key/pricing flows, and provider web chats inside the desktop app. The original work order excluded files required for generated themes and migrations, and required stopping before Tauri child webviews when the `unstable` feature was needed. The owner subsequently authorized all required project changes and delegated project execution to Codex.

## Decision

Generate the key-history migration with Drizzle and verify the production repository on SQLite. Preserve additive IPC compatibility and keyed, metered pricing extraction with explicit outcomes and persisted row provenance.

Add Neon Gold, Neon Cyan and Neon Violet through the deterministic palette generator, with both modes and tested contrast. Neon Gold becomes the default dark theme; existing saved theme choices continue to win. Generate the startup catalog with the theme catalog so React and pre-React styling agree.

Enable Tauri's `unstable` feature for child webviews. Use main-only async commands, saved HTTPS origin validation, separate persistent web-chat profiles, and no child capabilities or sidecar access. Hide views during resizing/dialogs rather than destroying their page state. Persist one-to-four-pane layouts and provide the external-browser sign-in fallback.

## Consequences and verification

The Rust API feature is opt-in; it does not select a nightly Rust compiler. Provider sign-in can still depend on the provider's embedded-browser policy, so the explicit warning and browser fallback remain necessary. Automated checks cover IPC contracts, migrated SQLite, pricing selection/outcomes, theme contrast/fallback/startup, layout/keyboard/persistence, URL guards and child capability isolation. Native runtime behavior and installer smoke remain separate from these checks; report only the checks actually executed.
