# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

A desktop mascot application built with Tauri 2 and Vue 3. A mascot image sits on the desktop in a transparent, frameless, always-on-top window and animates in response to the user's keyboard input. A separate settings window lets the user register mascot images, tune animation speed, and persist settings.

## Commands

- `pnpm tauri dev` — run the app in development mode (starts Vite via `beforeDevCommand`)
- `pnpm build` — type-check (`vue-tsc --noEmit`) and build the frontend
- `pnpm tauri build` — build the release binary
- `pnpm test` — run all tests: Rust backend (`pnpm test:rust`, i.e. `cargo test` in `src-tauri`) plus frontend (`pnpm test:front`, i.e. `vitest run` over `tests/`)
- `just lint` — run clippy (`-D warnings`) and Biome over the whole repo
- `just format` — run cargo fmt and Biome formatter
- Pre-commit hooks are managed by prek (`prek.toml`): cargo fmt, clippy,
  Biome (auto-fixing — re-stage if files change), and the comment-refs check.
  Frontend lint/format is Biome, not ESLint/Prettier.

## Architecture

Two-window Tauri app:

- **Main window** (label `main`): frameless, always-on-top, fixed 200x200, skips the taskbar. Defined in `src-tauri/tauri.conf.json`. Frontend entry is `src/main.ts` mounting `src/App.vue`.
- **Settings window**: normal resizable window built with PrimeVue components. Frontend entry is `src/settings.ts` mounting `src/SettingsWindow.vue`.

Key locations:

- `src-tauri/src/lib.rs` — Rust backend: `Settings` struct (serde, camelCase rename to match the frontend), Tauri commands for loading/saving settings as JSON in the app config directory, and the unit tests.
- `src/types/settings.ts` — TypeScript counterparts of the settings types (`Settings`, `WindowPosition`, `WindowSize`, `ImagePaths`). Keep these in sync with the Rust structs.
- PrimeVue components are auto-imported via `unplugin-vue-components` (see `vite.config.ts`, generated `components.d.ts`).

Windows communicate through the Tauri event system; settings changes propagate from the settings window to the main window, and main-window drag positions propagate back.

## Code Comments

- Comments must be self-contained. Never reference external documents or tickets by number — no "issue 12", "ADR-003", "Phase 1", "Task 2.1", "PR #1" (or Japanese equivalents like "フェーズ1", "タスク3"). Instead, briefly state the reasoning behind the implementation in place, so the comment stays meaningful without opening another file.
- This is enforced by a pre-commit hook (`scripts/check-comment-refs.sh` via `prek.toml`), which scans comment lines in staged source files and fails the commit on violations.

## Reference Documents

- `docs/specification.md` — application specification (Japanese)
- `docs/tasks.md` — overall task list
- `.tmp/design.md` / `.tmp/task.md` — current phase design and detailed sub-tasks (gitignored working documents; keep `task.md` updated as work progresses)
