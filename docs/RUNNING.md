# Running IT Studio (v1, developer mode)

> v1 has no installer yet (that is M9). You run it from this repository.

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

```bash
npm run dev
```

The first start compiles the Rust shell (a few minutes); later starts take seconds. The status bar shows **Ready v0.1.0** when the sidecar is up.

Data lives in `%APPDATA%\com.itstudio.app` (SQLite database, LanceDB vectors, logs). API keys are stored in **Windows Credential Manager**, never in files. To try things without touching your real data, start with a throw-away folder:

```bash
ITSTUDIO_DATA_DIR="$TEMP/itstudio-try" npm run dev
```

## 3. First steps

1. **Settings → API Keys** — paste a key for at least one provider (OpenAI, Anthropic, Google, xAI or Groq), press **Save**, then **Verify**. Keys are write-only: only the last 4 characters are shown.
2. **+ (Add project)** — give it a name and a workspace folder (an existing folder you want IT Studio to work in).
3. **Chat** — New chat → pick a model or "Auto (router ladder)" → send. Each answer shows its cost in USD and VND. If a model fails (rate limit, quota, 5xx) the router falls back automatically; with **Settings → Router → Auto Fallback** off it asks you.
4. **Knowledge** — add files/folders (paths relative to the workspace) → wait for "Indexed" → try a query → in Chat switch **Use knowledge** on to get answers with `[1]` citations.
5. **Code** — describe a change → **Run pipeline** → watch PM → Coder → Reviewer → Worker → Validate. Files are written only after review approval; a failed validation rolls everything back and shows a report with next steps. If VS Code is installed and **Settings → VS Code → Auto launch** is on, VS Code opens the project in a new window and highlights the changed files.
6. **Cost & P&L** — add revenue (USD or VND), set budgets; **Settings → Budget → Hard Stop** blocks paid calls once a budget is exceeded. "All projects" shows the portfolio view.
7. **Settings → Theme** — 18 themes, light / dark / system; **Language** en / vi.

## 4. Where to look when something goes wrong

- Status bar: *Connecting…* → *Ready*; a red banner means the sidecar crashed more than 5 times — it shows the logs folder.
- Logs: `%APPDATA%\com.itstudio.app\logs\sidecar-YYYYMMDD.log` (JSON, no prompt text, no keys).
- Pipeline journals: `<your workspace>\.itstudio\tx\` (kept after rollback for audit; `.itstudio/` is added to the project's `.gitignore`).

## 5. Known limitations in v1

- Developer mode only; installer, code signing and auto-update come with **M9**.
- Image generation / Gallery is disabled (**M8**).
- Price updates are manual (**Settings → Pricing → Update prices**, needs an active project — its cost is booked to that project, D31).
- Pipeline validation commands are shown but not yet editable per project.
- Sidecar cold start in dev is ~2.8 s (`tsx` transpiles at runtime; the M9 bundle will be faster).
- Workflow map (module graph with live activity) is specified (D32, milestone **MW**) and comes after this hand-over.

## 6. Running the tests

Before shipping a release, run `npm run audit:prod` to check production dependencies for high or critical vulnerabilities.

```bash
npm run typecheck && npm run lint && npm test     # unit (fast)
npm run test:integration                          # real sidecar, scripted providers (~3 min)
npm run test:e2e                                  # opens app windows (~10 min) — don't use mouse/keyboard meanwhile
npm run test:vscode-e2e                           # downloads an isolated VS Code build and opens one window
```
