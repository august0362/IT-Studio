# ADR-0001 — Foundational architecture decisions

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** User (product owner), Claude (Architect)

## Context

Discovery sessions established the product scope and the operating model: Claude specifies/plans/QAs; Codex implements; the in-app runtime uses API models with a resilient router. DeepSeek was dropped.

## Decision

Adopt decisions **D1–D16** exactly as listed in `CONTEXT.md` §3. Highlights:

- Node sidecar holds all logic; Tauri relays JSON-RPC over stdio (D1).
- Keychain-only secrets (D2).
- VS Code companion extension in v1; headless Worker validation is authoritative (D3).
- SQLite + embedded LanceDB + API embeddings (D4).
- Runtime roles PM/Reviewer = Claude, Coder = Codex-class, ≤ 1 fix round (D5).
- P&L with manual revenue; warning by default, optional Hard Stop; USD + VND display; auto-updated prices (D6–D9).
- Mandatory fallback with Auto Fallback toggle (D10).
- Snapshot → rollback → report on every failure (D11).
- Image generation and packaging specified now, built later (D12).

## Alternatives considered

| Topic | Rejected option | Reason |
|---|---|---|
| Core location | Router in Rust | Duplicated schemas across two languages |
| VS Code | Files-only viewer | User chose richer integration in v1 |
| Vectors | ChromaDB server / Pinecone | Extra process / data leaves machine |
| Embeddings | Local Ollama | Not installed; extra setup |
| Rollback (runtime) | Git-based snapshots | Would interfere with the user's own uncommitted work; journal touches only changed files |

## Consequences

- Native Node modules (better-sqlite3, LanceDB, keyring) complicate packaging → addressed in M9.
- Rust toolchain required on the dev machine (M0-01).
- Any change to a D-row requires a new ADR superseding this one.
