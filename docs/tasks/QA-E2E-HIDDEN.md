# QA-E2E-HIDDEN — Run E2E without visible, flashing windows

Role: Implementer · Size S · Model: gpt-6-luna medium · **Deps pre-installed** · Scope: `e2e/wdio.conf.ts`, `e2e/run-e2e.mjs`, `apps/desktop/src-tauri/src/lib.rs` (window setup only, debug/E2E path), a small Rust test if practical, this task file.

## Owner request

"Hide the screen — the E2E windows flash and are annoying." The owner keeps working on the same machine while E2E runs.

## Requirements

1. `wdio.conf.ts` starts the app with env `ITSTUDIO_E2E_OFFSCREEN=1` (in addition to existing E2E env).
2. In `lib.rs`, when `ITSTUDIO_E2E_OFFSCREEN=1` **and** the build is a debug build (`cfg!(debug_assertions)`), the main window is created/positioned off-screen (e.g. position `(-32000, -32000)` logical), keeps its normal size (so layout and WebDriver rendering work), `skip_taskbar(true)`, `focused(false)` / does not steal focus, and is never shown at the visible desktop position. Release builds ignore the variable entirely.
3. Child web-chat webviews follow the main window (no change needed if they are children; verify).
4. Stale-binary guard (V1QA-01): in `wdio.conf.ts` `onPrepare`, rebuild the debug app (`tauri build --debug --no-bundle`) when the exe is missing **or** older than the newest file under `apps/desktop/src`, `apps/desktop/src-tauri/src`, `apps/desktop/index.html`, `src/types/schemas.ts`.
5. Document in `docs/TESTING.md` (E2E section): E2E runs off-screen; set `ITSTUDIO_E2E_VISIBLE=1` to watch it (skips the off-screen positioning).

## Acceptance criteria

- [ ] `npx prettier --write` changed files; `npm run typecheck`, `npm run lint` pass; `cargo check` passes (QA runs outside the sandbox). QA runs the full E2E and confirms no window appears on screen.
