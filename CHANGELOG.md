# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/) · Rules: `CONVENTIONS.md` §9.

## [Unreleased]

### Added
- Add LanceDB vector store behind IVectorStore with contract suite ([M5-04](docs/tasks/M5-04.md))
- Add append-only cost ledger and ledger.query RPC ([M3-02](docs/tasks/M3-02.md))
- Add safe CommandRunner and tsc/eslint/vitest output parsers ([M6-03](docs/tasks/M6-03.md))
- Add RAG document parsers ([M5-01](docs/tasks/M5-01.md))
- Add ChatService with conversations, messages and streaming chat RPC ([M2-10](docs/tasks/M2-10.md))
- Add workspace path guard and file-system port ([M6-01](docs/tasks/M6-01.md))
- Add Auto Fallback OFF user decision flow and router config RPC ([M2-08/09](docs/tasks/M2-08.md))
- Add LlmRouter service: ordering, retry/backoff, fallback, circuit breaker, cancel, mid-stream reset ([M2-07](docs/tasks/M2-07.md))
- Add sidecar lifecycle logging ([M1-FIX2](docs/tasks/M1-FIX2.md))
- Add Google Gemini provider adapter ([M2-04](docs/tasks/M2-04.md))
- Add L3 sidecar integration harness and M1 integration suite ([M1-QA](docs/tasks/M1-QA.md))

### Fixed
- Accessible in-app ConfirmDialog replaces window.confirm (BUG-M1-005)
- UI RpcClient now sends request params (BUG-M1-004, S1)
- Deterministic RpcServer concurrency test (BUG-M1-001)
- Add VS Code extension session discovery and WebSocket bridge with handshake and reconnect ([M7-01](docs/tasks/M7-01.md))
- Add pure RAG chunker (heading/code aware, overlap) and token estimator ([M5-02](docs/tasks/M5-02.md))
- Add model + provider registries with eligibility checks and models.list RPC ([M2-05](docs/tasks/M2-05.md))
- Add status bar and write-only Settings → API Keys page ([M1-07](docs/tasks/M1-07.md))
- Add OpenAI-compatible provider adapter for OpenAI, xAI, Groq, Together ([M2-03](docs/tasks/M2-03.md))
- Add OS keychain secret store, provider key verification and write-only secrets RPC ([M1-06](docs/tasks/M1-06.md))
- Add Anthropic provider adapter ([M2-02](docs/tasks/M2-02.md))
- Add SQLite persistence (WAL, drizzle migrations), settings and project services with RPC ([M1-05](docs/tasks/M1-05.md))
- Add integer µUSD cost computation and dual USD/VND money display ([M3-01](docs/tasks/M3-01.md))
- Add sidecar JSON-RPC server over NDJSON stdio, typed event bus, redacting pino logger, composition root ([M1-02](docs/tasks/M1-02.md))
- Add LLM provider port, failure taxonomy, provider contract test suite and HTTP fixture harness ([M2-01](docs/tasks/M2-01.md))
- Add pure LLM router state machine and retry backoff ([M2-06](docs/tasks/M2-06.md))
- Add zod validators for all boundary contracts, exhaustive RPC catalogs, seed config loader ([M1-01](docs/tasks/M1-01.md))
- Add typed UI RpcClient, Tauri transport, React Query hooks and sidecar status store ([M1-04](docs/tasks/M1-04.md))
- Add Vitest projects for all packages with coverage thresholds ([M0-06](docs/tasks/M0-06.md))
- Add Tauri sidecar supervisor: NDJSON relay, ready gate, restart backoff with fatal limit, graceful shutdown, locked-down capabilities ([M1-03](docs/tasks/M1-03.md))
- Add strict lint gate: typescript-eslint strict-type-checked, layer boundaries, Prettier, secret scanner with self-test ([M0-05](docs/tasks/M0-05.md))
- Add npm-workspaces monorepo scaffold: sidecar, desktop (Tauri v2 + React 19 + Vite 8 + Tailwind 4), VS Code extension skeleton ([M0-04](docs/tasks/M0-04.md))

### Docs
- Add theme system spec with 18 color-psychology themes derived from user palettes (docs/design/THEMES.md, config/themes.json) (D17)
- Add specification set: CONTEXT, ARCHITECTURE, ROLES, ROADMAP, CONVENTIONS, AGENTS, ADR-0001 (M0-00)
- Add canonical contracts `src/types/schemas.ts` — strict, zero `any` (M0-00)
