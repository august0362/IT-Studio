# Running IT Studio

> Current status (2026-10-04): v1 implementation and OWNER-FB1 installer builds are delivered. Release sign-off remains pending M9-QA, runtime-isolated install smoke and the native provider/theme follow-ups recorded in `docs/tasks/OWNER-FB1.md` and `docs/HANDOFF.md`.

## Install IT Studio

After release QA, run the approved IT Studio NSIS installer (`IT Studio_<version>_x64-setup.exe`). Local NSIS/MSI build artifacts are under `apps/desktop/src-tauri/target/release/bundle/`. Windows SmartScreen may show a warning because the installer is unsigned (D33). Select **More info** → **Run anyway** to continue.

IT Studio stores its database, vectors and logs in `%APPDATA%\com.itstudio.app`. API keys are stored in Windows Credential Manager. To uninstall, open **Settings → Apps → Installed apps**, select **IT Studio**, then choose **Uninstall**. Uninstalling does not remove your app data; delete `%APPDATA%\com.itstudio.app` separately if you want to remove it.

## Run from the repository (developer mode)

## 1. Prerequisites (already present on this machine)

| Tool | Version | Check |
|---|---|---|
| Node.js | 24.x | `node -v` |
| Rust + cargo (for the Tauri shell) | stable | `cargo -V` |
| WebView2 runtime | built into Windows 11 | — |
| VS Code (optional, for the companion) | 1.100+ | `code -v` |

First time only (or after pulling new dependencies):

```bash
npm install
npm run package -w itstudio-vscode     # builds the companion extension (.vsix) the app installs into VS Code
```

## 2. Start the app

Double-click `Start-IT-Studio.bat` at the repository root. It checks Node.js, npm and Rust, installs dependencies when `node_modules` is missing or its lockfile is older than `package-lock.json`, then starts the app. If a prerequisite or command fails, the window stays open with an error message. The launcher uses the repository-local `.npm-cache/`.

From Windows Command Prompt, including a repository path with spaces:

```bat
"C:\path with spaces\IT Studio\Start-IT-Studio.bat"
```

To use a throw-away data folder:

```bat
Start-IT-Studio.bat --data-dir "%TEMP%\itstudio-try"
```

Without `--data-dir`, the launcher uses `ITSTUDIO_DATA_DIR` if already set, otherwise the normal app-data directory. Relative folder paths resolve from the repository root. This separates the database, vectors and logs; Windows Credential Manager remains shared.

Or start manually:

```bash
npm run dev
```

The first start compiles the Rust shell (a few minutes); later starts take seconds. The status bar shows **Ready v0.1.0** when the sidecar is up.

Data lives in `%APPDATA%\com.itstudio.app` (SQLite database, LanceDB vectors, logs). API keys are stored in **Windows Credential Manager**, never in files. For a separate developer/debug database, vector store and logs, start with a throw-away folder:

```bash
ITSTUDIO_DATA_DIR="$TEMP/itstudio-try" npm run dev
```

This override applies to developer/debug builds and does not isolate Windows Credential Manager. Automated tests use the supplied harnesses with scripted providers and fake key storage. Release builds use their normal app-data directory.

## 3. First steps

1. **Settings → API Keys** — paste a key for at least one provider (OpenAI, Anthropic, Google, xAI or Groq), then press **Verify & save**. The candidate is verified before storage; failure preserves the existing saved key. Status and action history show only the last 4 characters.
2. **+ (Add project)** — give it a name and a workspace folder (an existing folder you want IT Studio to work in).
3. **Chat** — New chat → pick a model or "Auto (router ladder)" → send. Each answer shows its cost in USD and VND. If a model fails (rate limit, quota, 5xx) the router falls back automatically; with **Settings → Router → Auto Fallback** off it asks you.
4. **Knowledge** — add files/folders (paths relative to the workspace) → wait for "Indexed" → try a query → in Chat switch **Use knowledge** on to get answers with `[1]` citations.
5. **Code** — describe a change → **Run pipeline** → watch PM → Coder → Reviewer → Worker → Validate. Files are written only after review approval; a failed validation rolls everything back and shows a report with next steps. If VS Code is installed and **Settings → VS Code → Auto launch** is on, VS Code opens the project in a new window and highlights the changed files.
6. **Cost & P&L** — add revenue (USD or VND), set budgets; **Settings → Budget → Hard Stop** blocks paid calls once a budget is exceeded. "All projects" shows the portfolio view.
7. **Settings → Theme** — 21 themes, light / dark / system; Arctic Focus is the default light theme and Neon Gold the default dark theme. Saved selections take precedence. **Language** en / vi.
8. **Settings → Images** — enable generation and configure a supported provider; Chat renders generated images and opens a lightbox. **Gallery** shows images, prompts and costs for the active project.
9. **Workflow** — open the live module graph; click a node for activity, counters, metrics and deep links. Activity dots animate along links; reduced motion uses edge highlighting.
10. **Web chat** — choose one to four enabled saved sites and resize panes with the pointer or arrow keys. **Settings → Web chat** manages links and the external browser; installed Cốc Cốc is the first-load default. Use **Open in browser** when a provider blocks embedded sign-in. The Chat header also retains the external-browser menu and Copy project brief.
11. **Settings → Pricing** — with an active project and a saved provider key, select an eligible extractor, review the planning estimate and click **Update prices**. Results explain provider outcomes; row origins distinguish unverified seed, auto and manual prices. Extraction cost is booked to the active project.

## 4. Where to look when something goes wrong

- Status bar: *Connecting…* → *Ready*; a red banner means the sidecar crashed more than 5 times — it shows the logs folder.
- Logs: `%APPDATA%\com.itstudio.app\logs\sidecar-YYYYMMDD.log` (JSON, no prompt text, no keys).
- Pipeline journals: `<your workspace>\.itstudio\tx\` (kept after rollback for audit; `.itstudio/` is added to the project's `.gitignore`).

## 5. Known limitations in v1

- The installer is unsigned (D33); SmartScreen requires **More info → Run anyway**.
- Image generation requires enabling it and configuring a supported provider/key; the Midjourney proxy remains disabled.
- Price updates are manual (**Settings → Pricing → Update prices**) and need an active project (its cost is booked to that project, D31) plus an eligible keyed extractor model. Seed rows stay marked unverified until an app refresh confirms them; unconfirmed seed prices are listed in the OWNER-FB1 Result.
- Pipeline validation commands are shown but not yet editable per project.
- Sidecar cold start: about 2.8 s in dev (`tsx` transpiles at runtime); the packaged SEA sidecar starts in about 0.5 s warm (first cold start measured 2.1 s, M9-OBS-04).
- Embedded web chat: some providers block sign-in inside an embedded pane; use **Open in browser** instead.

## 6. Running the tests

Before shipping a release, run `npm run audit:prod` to check production dependencies for high or critical vulnerabilities.

### Release checklist

1. `npm run release:bump -- <major|minor|patch|x.y.z>` updates the app and extension versions and moves the current `Unreleased` changelog entries into the release section. Review the printed changes first with `--dry-run`.
2. `npm run audit:prod` checks production dependencies.
3. `npm run build:app` builds the Windows NSIS and MSI installers with the bundled sidecar and WebView2 bootstrapper.
4. Run `npm run smoke:install` to verify the installed app starts without system Node.js or repository dependencies. It opens the app window, uses the real `%APPDATA%\\com.itstudio.app` data directory, and is QA-only; do not run during E2E tests.
5. For the same release build, install the MSI for the current user into a temporary folder under `%LOCALAPPDATA%`, verify the app reaches Ready with its bundled sidecar, then uninstall that test installation. Preserve the existing `%APPDATA%\\com.itstudio.app` data directory. Record the exact MSI hash and installation path in the QA report.
6. After the release is approved, create the matching tag with `git tag v<version>`. D33 defers code signing and automatic updates; this checklist does not enable an updater.

```bash
npm run typecheck && npm run lint && npm test     # unit (fast)
npm run test:integration                          # real sidecar, scripted providers (~3 min)
npm run test:e2e                                  # opens app windows (~10 min) — don't use mouse/keyboard meanwhile
npm run test:vscode-e2e                           # downloads an isolated VS Code build and opens one window
```

Release script unit tests: `node --test scripts/release/bump-version.test.mjs`.
