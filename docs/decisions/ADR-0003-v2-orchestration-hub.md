# ADR-0003 — v2: Multi-Agent & Omnichannel Orchestration Hub

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** User (product owner), Claude (Architect)

## Context

The user wants the Node sidecar to evolve into a hub that runs specialized agents with long-term memory and connects them to multiple channels (app UI, VS Code, Gmail, Facebook). Token cost is a primary concern.

## Decision

Adopt CONTEXT D18–D23:

- **Scheduling:** v2 is built **after v1** (M0–M7) as milestones M10–M14.
- **Agents:** built-in templates plus user-created agents. There is no supervisor agent; routing is rule-based plus user choice.
- **Memory:**
  - Auto-extracted facts/preferences per agent + project, stored in LanceDB + SQLite.
  - The user can view, edit, pin and delete memories.
  - Extraction from external channels is off by default.
- **Channels:**
  - App, VS Code chat panel, Gmail (triage, draft replies, email commands, email reports) and Facebook **Page** Messenger.
  - Personal Facebook accounts are excluded (no API; ToS).
- **On-demand only:** no background polling, schedulers or agent runs for channels. Everything is started by a user action.
- **Approval:** every outbound message to an external channel goes through the Outbox and needs explicit user approval.

## Alternatives rejected

| Option | Reason |
|---|---|
| Background polling / tray mode | User does not want token or compute spend without an action |
| Facebook webhooks via Cloudflare Tunnel | Exposes a public endpoint; contradicts on-demand principle |
| Auto-send replies | Prompt-injection and wrong-recipient risk |
| Supervisor agent auto-delegation | Not chosen; it can be added later as a template |
| Embed full history as memory | Embedding cost, noise and PII retention |

## Consequences

- Email commands are processed only at the next user-triggered sync.
- Facebook replies must respect the 24 h messaging window. Late drafts expire.
- The user must create a Google Cloud OAuth client and a Meta app themselves. Setup guides are part of M13/M14.
- The v1 pipeline is re-expressed as an agent team in M10, with no behaviour change.
