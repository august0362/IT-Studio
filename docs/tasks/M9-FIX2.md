# M9-FIX2 — Make the MSI per-user

Milestone: M9 · Follow-up to M9-02 · Role: Implementer

## Scope

- `apps/desktop/src-tauri/tauri.conf.release.json`
- `apps/desktop/src-tauri/wix/main.wxs` (new custom WiX template)
- `.prettierrc.json` (format the WiX template with Prettier's HTML parser)
- `scripts/build/wix-template.test.mjs` (new)
- `scripts/build/build-app.mjs` (pre-bundle generation of the per-user WiX resource tree)
- `scripts/build/wix-per-user.mjs` and `scripts/build/wix-per-user.test.mjs` (new generator and regression test)
- This task file, for the result only

## Requirements

1. Make the MSI honor M9-02's per-user installation requirement using the Tauri-pinned WiX v3 template, without changing NSIS behavior.
2. Install the app under the current user's writable Local AppData directory; use current-user registry and shell associations.
3. Preserve Tauri's generated product metadata, sidecar/resources, WebView2 bootstrapper, shortcuts, upgrade behavior, and installer UI.
4. Add a regression test for the release config/template's per-user scope and directory/registry roots.
5. Generate resource components with an HKCU registry KeyPath and uninstall directory cleanup for every staged resource. Tauri 2.12.1 injects its resource components as raw XML with file KeyPaths, which fails WiX ICE38 and ICE64 under Local AppData. Use the existing Tauri/WiX toolchain and generated build files; keep the shipped resource layout unchanged. Do not suppress ICE validation or alter dependency versions.

## Acceptance criteria

- `npm run typecheck`, `npm run lint`, and `npm test` pass.
- `npm run build:app` builds NSIS and MSI; the generated MSI WiX source shows `InstallScope="perUser"`, a Local AppData install root, and current-user protocol registration.
- WiX Light passes ICE38 and ICE64 without suppressions; the final MSI preserves embedded WebView2, sidecar/resources, and clean uninstall behavior.
- Do not install the MSI or launch the app; leave installation smoke to M9-QA with a safe test profile.

## Result

- Summary: Added a Tauri 2.12.1 WiX template that installs per user under Local AppData and writes deep-link protocol registrations to HKCU. The release overlay enables it for MSI only; NSIS configuration is unchanged. Added regression coverage and a Prettier HTML-parser override for `.wxs` templates.
- Files changed: `.prettierrc.json`, `apps/desktop/src-tauri/tauri.conf.release.json`, `apps/desktop/src-tauri/wix/main.wxs`, `scripts/build/wix-template.test.mjs`, `docs/tasks/M9-FIX2.md`.
- Dependencies added (with reason): None.
- Decisions taken within scope: Based the template on the Tauri 2.12.1 pinned upstream template. Preserved its product metadata, shortcuts, associations, upgrade rules, resources, UI, and WebView2 actions while changing install scope, install root, and protocol registry root.
- Open issues / follow-ups: `npm run typecheck`, `npm run lint`, and `npm test` passed (860 passed, 1 skipped; 8 Node tests passed). Sidecar and NSIS builds passed. The production MSI build stopped when Tauri's embed-bootstrapper download failed with a TLS close-notify error. A temporary skip-WebView2 overlay rendered the custom WXS and Candle accepted it, but Tauri's Light step returned an error; M9-QA should rebuild MSI with network access and verify the final installer. The switch from per-machine to per-user means Windows Installer cannot major-upgrade an already-installed per-machine MSI; handoff evidence says the previous MSI was built but not installed.

## Blocked

- Question: Can M9-QA rebuild the production MSI in an environment where Tauri can download the embedded WebView2 bootstrapper and complete the WiX Light step?
- What I tried: Built the sidecar and NSIS package. The production MSI attempt failed during the Microsoft bootstrapper download with a TLS close-notify error. A temporary skip-WebView2 overlay rendered the custom WXS and Candle compiled it, but Tauri's Light step still returned an error. No installer was installed and no app was launched.

## Result (reverification 2026-10-04)

- Summary: The task branch is synced to `main`; the per-user MSI template passes its regression test and the generated MSI staging output confirms the expected install roots and WebView2 bootstrapper action.
- Files changed: `.prettierrc.json`, `apps/desktop/src-tauri/tauri.conf.release.json`, `apps/desktop/src-tauri/wix/main.wxs`, `scripts/build/wix-template.test.mjs`, `docs/tasks/M9-FIX2.md`.
- Dependencies added (with reason): None. A fresh install failed twice with npm registry `ECONNRESET`; verification used the already-installed dependencies from the main checkout with the same lockfile.
- Decisions taken within scope: Kept the MSI per-user template and MSI-only release overlay; did not change NSIS configuration.
- Open issues / follow-ups: `npm run typecheck` passed; `npm run lint` passed; `npm test` passed (922 passed, 1 skipped; all 8 Node build/release tests passed). `npm run build:app` built the sidecar, Vite app, Rust release binary, and NSIS installer, downloaded the WebView2 bootstrapper, and compiled the generated WiX source with Candle. WiX Light then failed with `failed to run ...light.exe`, so Tauri exited 1 and did not place an MSI in `target/release/bundle/msi`. Light did create `target/release/wix/x64/output.msi` (147,728,512 bytes); read-only MSI database inspection confirmed `INSTALLDIR` is under `LocalAppDataFolder`, registry rows use HKCU, and `InvokeBootstrapper` is present. The 52 icon files regenerated during the build were restored and their hashes match the pre-build backup. Tauri's Windows installer guide identifies the optional Windows VBSCRIPT feature as a prerequisite when Light reports this error; checking its state requires elevation, which this shell does not have.

## Blocked (reverification 2026-10-04)

- Question: Can an administrator enable the Windows VBSCRIPT optional feature (Settings → Apps → Optional features → More Windows features), or run the build from an elevated session, so `npm run build:app` can be retried and the MSI lands in the bundle directory?
- What I tried: `Get-WindowsOptionalFeature` and `DISM /Online /Get-FeatureInfo /FeatureName:VBSCRIPT` both require elevation. The current build produced a staged MSI with the expected per-user settings and embedded WebView2 action, but Tauri's Light step returned an error. I did not install the MSI or launch the app.

## QA diagnosis and reassignment (2026-10-11)

- Architect: Keep the M9-02 per-user MSI and embedded WebView2 requirements. The work order covers the WiX template, its release overlay, the pre-bundle resource-component generator, their regression tests, Prettier configuration, and this task file; no package manifest or application contract is in scope.
- Implementer: Fix the template's per-user components so WiX ICE38 accepts every file under the user profile with an HKCU registry KeyPath. Preserve the generated sidecar, resources, shortcuts, metadata, upgrade behavior, and WebView2 action. Extend the regression test to catch file KeyPaths under the per-user install tree. Do not edit package manifests or application contracts.
- QA/Reviewer: Review against ../CONVENTIONS.md §10 and ../TESTING.md; run Prettier, typecheck, lint, tests, and the production MSI build. Check the final MSI database and isolated per-user installation in M9-QA.
- Evidence: On this machine the VBSCRIPT capability is already installed. A diagnostic MSI build reached WiX Light and failed with `LGHT0204 ICE38`: components `Path`, `itstudio_sidecar.exe`, and generated resource components install to a user-profile directory but use file KeyPaths. ICE91 warnings also appeared. The production build independently timed out downloading the Microsoft WebView2 bootstrapper before reaching Light; that network issue remains to be rechecked after the template fix.

## Result (per-user WiX validation fix, 2026-10-11)

- Summary: The production `npm run build:app` now produces both NSIS and per-user MSI packages. The WiX template gives the main app and sidecar HKCU registry KeyPaths. Before bundling, `build-app.mjs` generates the MSI resource tree from the staged `resources/**` files with stable component IDs and GUIDs, an HKCU registry KeyPath for each component, and uninstall cleanup for every resource directory. NSIS still uses Tauri's normal resource mapping.
- Files changed: `.prettierrc.json`, `apps/desktop/src-tauri/tauri.conf.release.json`, `apps/desktop/src-tauri/wix/main.wxs`, `scripts/build/build-app.mjs`, `scripts/build/wix-template.test.mjs`, `scripts/build/wix-per-user.mjs`, `scripts/build/wix-per-user.test.mjs`, and this task file.
- Dependencies added (with reason): None.
- Decisions taken within scope: Keep the tracked Tauri-pinned WiX template as the source, generate its populated variant under ignored `target/itstudio-wix/`, and derive resource component identities from relative install paths so they remain stable across worktrees. Resolve resource source paths to absolute paths so WiX Light finds them from its own working directory. Keep the embedded WebView2 action in the production MSI.
- Open issues / follow-ups: No M9-FIX2 build blocker remains. Prettier, `npm run typecheck`, `npm run lint`, and `npm test` passed (922 passed, 1 skipped Vitest; 11 Node tests passed). The production NSIS installer is 93,246,937 bytes and the MSI is 147,797,060 bytes. Read-only MSI inspection found `INSTALLDIR` under `LocalAppDataFolder`, 760 files, 923 components and HKCU registry KeyPaths, 162 RemoveFile rows, and the embedded `MicrosoftEdgeWebview2Setup.exe` plus `InvokeBootstrapper`. No URL protocol is configured in this release, so the final MSI has no protocol row; the template's conditional protocol registration uses HKCU and is covered by the regression test. M9-QA still needs isolated installation, launch, and uninstall smoke; no installer was installed or app launched in this task. A prior parallel test run hit one existing RAG test timeout under lint load; the serial rerun passed.
