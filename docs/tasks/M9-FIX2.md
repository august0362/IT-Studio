# M9-FIX2 — Make the MSI per-user

Milestone: M9 · Follow-up to M9-02 · Role: Implementer

## Scope

- `apps/desktop/src-tauri/tauri.conf.release.json`
- `apps/desktop/src-tauri/wix/main.wxs` (new custom WiX template)
- `.prettierrc.json` (format the WiX template with Prettier's HTML parser)
- `scripts/build/wix-template.test.mjs` (new)
- This task file, for the result only

## Requirements

1. Make the MSI honor M9-02's per-user installation requirement using the Tauri-pinned WiX v3 template, without changing NSIS behavior.
2. Install the app under the current user's writable Local AppData directory; use current-user registry and shell associations.
3. Preserve Tauri's generated product metadata, sidecar/resources, WebView2 bootstrapper, shortcuts, upgrade behavior, and installer UI.
4. Add a regression test for the release config/template's per-user scope and directory/registry roots.

## Acceptance criteria

- `npm run typecheck`, `npm run lint`, and `npm test` pass.
- `npm run build:app` builds NSIS and MSI; the generated MSI WiX source shows `InstallScope="perUser"`, a Local AppData install root, and current-user protocol registration.
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
