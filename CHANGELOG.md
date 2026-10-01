# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/) · Rules: `CONVENTIONS.md` §9.

## [Unreleased]

### Added
- Add npm-workspaces monorepo scaffold: sidecar, desktop (Tauri v2 + React 19 + Vite 8 + Tailwind 4), VS Code extension skeleton ([M0-04](docs/tasks/M0-04.md))

### Docs
- Add theme system spec with 18 color-psychology themes derived from user palettes (docs/design/THEMES.md, config/themes.json) (D17)
- Add specification set: CONTEXT, ARCHITECTURE, ROLES, ROADMAP, CONVENTIONS, AGENTS, ADR-0001 (M0-00)
- Add canonical contracts `src/types/schemas.ts` — strict, zero `any` (M0-00)
