# ADR-0002 — Toolchain version pins

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** Claude (Architect)

## Context

npm `latest` for `typescript` is 7.0.x (native port). `typescript-eslint@8.71` declares peer `typescript >=4.8.4 <6.1.0`, so TS 7 would break the lint gate required by CONVENTIONS §2–3.

## Decision

Pin the following majors (caret within major unless noted). Upgrades require a new ADR.

| Tool | Pin |
|---|---|
| Node | ≥ 24.19 (engines) |
| TypeScript | `~6.0.3` (exact minor) |
| typescript-eslint | `^8.71` |
| ESLint | `^10` |
| Vitest | `^5` |
| Vite | `^8` |
| React / React DOM | `^19.3` |
| Tauri CLI / API | `^2.12` (Rust crate `tauri = "2"`) |
| Tailwind CSS | `^4` (via `@tailwindcss/vite`) |
| zod | `^4` |
| tsx | `^4` |
| drizzle-orm | `^0.45` (stable line; 1.0 is pre-release) |
| better-sqlite3 | `^13` |
| @lancedb/lancedb | `^0.39` |
| @napi-rs/keyring | `^2` |
| Rust | stable 1.99 MSVC |

## Consequences

Revisit when typescript-eslint supports TS 7 (would allow `tsgo` for faster typechecking).
