# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/) · Rules: `CONVENTIONS.md` §9.

## [Unreleased]

### Added
- Add typed UI RpcClient, Tauri transport, React Query hooks and sidecar status store ([M1-04](docs/tasks/M1-04.md))
- Add Vitest projects for all packages with coverage thresholds ([M0-06](docs/tasks/M0-06.md))
- Add Tauri sidecar supervisor: NDJSON relay, ready gate, restart backoff with fatal limit, graceful shutdown, locked-down capabilities ([M1-03](docs/tasks/M1-03.md))
- Add strict lint gate: typescript-eslint strict-type-checked, layer boundaries, Prettier, secret scanner with self-test ([M0-05](docs/tasks/M0-05.md))
- Add npm-workspaces monorepo scaffold: sidecar, desktop (Tauri v2 + React 19 + Vite 8 + Tailwind 4), VS Code extension skeleton ([M0-04](docs/tasks/M0-04.md))

### Docs
- Add theme system spec with 18 color-psychology themes derived from user palettes (docs/design/THEMES.md, config/themes.json) (D17)
- Add specification set: CONTEXT, ARCHITECTURE, ROLES, ROADMAP, CONVENTIONS, AGENTS, ADR-0001 (M0-00)
- Add canonical contracts `src/types/schemas.ts` — strict, zero `any` (M0-00)
