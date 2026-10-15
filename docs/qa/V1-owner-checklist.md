# IT Studio v1 — Owner acceptance checklist

> Status: **DRAFT** — finalized by V1-QA (build hash, installer path and automated results filled in below). Tick each box; write what you saw in *Notes* when something is off.

## 0. Before you start

- Build under test: `<filled by V1-QA: installer file, SHA-256, commit>`
- Automated results for this build: `<filled by V1-QA: unit / integration / E2E / smoke counts>`
- You need: at least **two** provider API keys (e.g. OpenAI + Anthropic or Google), one empty test folder as a workspace, ~45 minutes.
- Report problems as: *section · step · what you did · what you expected · what happened* (+ screenshot). Severity: **S1** data loss / crash / key leak · **S2** feature broken · **S3** wrong but usable · **S4** cosmetic.

## 1. Install and start

| ✓ | Step | Expected | Notes |
|---|---|---|---|
| ☐ | Run the NSIS installer (SmartScreen → More info → Run anyway) | Installs; Start-menu entry "IT Studio" | |
| ☐ | Start the app | Status bar *Connecting…* → *Ready* within ~3 s; no red banner | |
| ☐ | Close and reopen | Same projects/settings; starts Ready again | |

## 2. API keys and router

| ✓ | Step | Expected | Notes |
|---|---|---|---|
| ☐ | Settings → API Keys: paste a **wrong** key → Verify & save | Rejected with a clear message; nothing saved | |
| ☐ | Paste your real key → Verify & save | Saved; only the last 4 characters shown | |
| ☐ | Settings → Router: toggle Auto Fallback off, send a chat to a model whose key is missing | App asks what to do (use another model / retry / abort) | |

## 3. Projects and Chat

| ✓ | Step | Expected | Notes |
|---|---|---|---|
| ☐ | + Add project with your test folder | Project tab appears | |
| ☐ | Chat → New chat → Auto → send "hello" | Streams an answer; cost shown in USD and VND | |
| ☐ | Create a second project, switch between projects quickly | Each project shows only its own conversations; you can never send into the other project's chat | |

## 4. Code pipeline — clarifying step (new)

| ✓ | Step | Expected | Notes |
|---|---|---|---|
| ☐ | Settings → Pipeline: **Auto-answer clarifying questions** OFF. Code → describe a vague change ("add login") → Run | Pipeline may stop at **Clarify** with up to 5 questions; each has options, one tagged **Recommended** with a reason | |
| ☐ | Answer one with your own text, accept the rest → Submit | Run continues to Spec → Code → Review → Write → Validate | |
| ☐ | Turn **Auto-answer** ON, run another vague request | Never waits; questions show **Auto-chosen** answers in the run | |
| ☐ | Remove all keys for the pipeline roles' providers (or point a role at a provider without a key) → Run | Run does **not** start; message names the missing key/provider and links to Settings → Pipeline | |
| ☐ | A run that fails before writing | Report says **"Nothing was written to your project."** | |
| ☐ | A run that fails validation | Files rolled back; report with next steps | |

## 5. Pipeline Studio (new add-on)

| ✓ | Step | Expected | Notes |
|---|---|---|---|
| ☐ | Settings (bottom) → **Pipeline Studio** | Full-screen black page, no app chrome; modules Request → Clarify → Spec → Code → Review → (Fix → Re-review) → Write → Validate → Done | |
| ☐ | Start a run from **New request** on that page | Glowing dot travels module to module; active module pulses; ✓ appears on finished modules | |
| ☐ | Run that asks questions (Auto OFF) | **?** on Clarify; click it → answer in the panel → run continues | |
| ☐ | Drag modules around, leave and come back | Positions kept; **Reset layout** restores | |
| ☐ | Click each module | Side panel with all its information (prompt, questions, spec, files, findings, commands, result/cost) | |
| ☐ | A failed run | ✕ on the failing module; Done stays grey | |
| ☐ | Esc / ← Back | Closes panel first, then returns to the previous page | |

## 6. Knowledge, Workflow, Images, Web chat

| ✓ | Step | Expected | Notes |
|---|---|---|---|
| ☐ | Knowledge → add a folder → wait for Indexed → query | Relevant hits; Chat with *Use knowledge* cites `[1]` | |
| ☐ | Delete a source while it is re-indexing | It stays deleted (does not come back) | |
| ☐ | Workflow → open the graph, Fit view at your window size | All nodes visible; a module that finished work is no longer "Active" | |
| ☐ | Settings → Images → enable a provider → ask Chat for an image | Image renders; Gallery lists it with prompt and cost | |
| ☐ | Web chat → open 2 panes; Open in browser | Panes load or show Open in browser; external browser opens | |

## 7. Cost, budget, pricing

| ✓ | Step | Expected | Notes |
|---|---|---|---|
| ☐ | Cost → Add revenue, double-click Add fast | Exactly **one** revenue row | |
| ☐ | All projects view → Top spend by project | Shows project **names** | |
| ☐ | Settings → Budget → Hard Stop with a tiny budget → send a chat | Paid call blocked with a clear message | |
| ☐ | Settings → Pricing: set a manual price on one model, then clear it; restart the app and clear again | Only that row's Origin label changes; after restart clearing restores the last fetched/verified price, not the seed | |

## 8. VS Code (if installed)

| ✓ | Step | Expected | Notes |
|---|---|---|---|
| ☐ | Settings → VS Code → Auto launch on → run a pipeline that writes files | VS Code opens the project and highlights changed files | |

## 9. Safety spot checks

| ✓ | Step | Expected | Notes |
|---|---|---|---|
| ☐ | Open `%APPDATA%\com.itstudio.app\logs\sidecar-*.log` | No API keys, no prompt text | |
| ☐ | Task Manager → kill "IT Studio" sidecar during a pipeline write, reopen | Workspace restored; run shown as rolled back with a report | |

## 10. Sign-off

- ☐ All sections pass, or every failure is reported with a severity.
- Owner: ____________ Date: ____________ Verdict: **accept / accept with follow-ups / reject**
